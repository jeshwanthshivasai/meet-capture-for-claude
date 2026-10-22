// The service worker. It keeps track of live calls, stores what the Meet tab sends (captions and
// snapshots), feeds the captures page, and runs exports: the offscreen page builds the ZIP, the
// downloads API writes it under Downloads/Meet captures. Nothing here talks to the network.
importScripts('src/common.js', 'src/store.js', 'src/export.js');
const C = MCC, S = MCC.store;

let settings = C.settingsWithDefaults(null);
const settingsReady = chrome.storage.local.get('settings').then((r) => { settings = C.settingsWithDefaults(r.settings); }).catch(() => {});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.settings) { settings = C.settingsWithDefaults(ch.settings.newValue); broadcast({ type: 'settings', settings }); }
});

const live = new Map();      // tabId → { meetingId, port, status }
const endTimers = new Map(); // meetingId → timer: grace period after the page goes away
const apps = new Set();      // ports of open captures pages
const exporting = new Set(); // meeting ids being exported
const APP_URL = chrome.runtime.getURL('app/index.html');

chrome.runtime.onInstalled.addListener(async (d) => {
  if (d.reason === 'install') await chrome.storage.local.set({ settings: C.DEFAULT_SETTINGS }).catch(() => {});
  else if (d.reason === 'update') { // settings from earlier builds: keep what still exists, map the old export switch
    const { settings: old } = await chrome.storage.local.get('settings').catch(() => ({}));
    if (old && typeof old === 'object') {
      const next = C.settingsWithDefaults(old);
      if (old.autoExport === false) next.afterCall = 'open';
      else if (old.autoExport === true && old.exportFormat === 'zip') next.afterCall = 'both';
      await chrome.storage.local.set({ settings: next }).catch(() => {});
    }
    chrome.sidePanel && chrome.sidePanel.setPanelBehavior && chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
  housekeeping();
});
chrome.runtime.onStartup.addListener(housekeeping);
chrome.action.onClicked.addListener(() => openApp(null));
restoreLive();

async function housekeeping() {
  await settingsReady;
  try { await S.prune(settings.keepDays); } catch (e) { /* storage trouble is reported when the page opens */ }
  // Meetings left "live" by a browser that closed mid-call: give their tabs a moment to come back, then close them off.
  setTimeout(async () => {
    const stale = (await S.listMeetings(200).catch(() => [])).filter((m) => m.status === 'live' && ![...live.values()].some((e) => e.meetingId === m.id));
    for (const m of stale) {
      await S.updateMeeting(m.id, { status: 'ended', endedAt: m.endedAt || m.startedAt + 1, endReason: 'browser closed', tabId: null });
      if ((settings.afterCall === 'zip' || settings.afterCall === 'both') && !m.zipAt && (m.lineCount || m.snapshotCount)) exportZip(m.id, { auto: true });
    }
    if (stale.length) broadcastState();
  }, 15000);
}
async function restoreLive() {
  try {
    const { live: saved } = await chrome.storage.session.get('live');
    for (const [tabId, meetingId] of saved || []) if (!live.has(tabId)) live.set(tabId, { meetingId, port: null, status: {} });
  } catch (e) { /* no session storage */ }
}
const saveLive = () => chrome.storage.session.set({ live: [...live].map(([tabId, e]) => [tabId, e.meetingId]) }).catch(() => {});

// ------------------------------------------------------------------ ports
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'content') contentPort(port);
  else if (port.name === 'app') appPort(port);
});

function contentPort(port) {
  const tabId = port.sender && port.sender.tab ? port.sender.tab.id : null;
  if (tabId == null) { try { port.disconnect(); } catch (e) { /* fine */ } return; }
  port.onMessage.addListener((m) => { onContent(m).catch((e) => console.warn('[MeetCapture]', e)); });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    const cur = live.get(tabId);
    if (!cur || cur.port !== port) return;
    cur.port = null;
    scheduleEnd(tabId, cur.meetingId, 'tab closed');
  });

  async function onContent(m) {
    if (!m || typeof m.type !== 'string') return;
    const cur = live.get(tabId);
    switch (m.type) {
      case 'hello':
      case 'meeting-start': {
        if (!m.meeting || !m.meeting.id) return;
        cancelEnd(m.meeting.id);
        const existing = await S.getMeeting(m.meeting.id);
        const rec = existing || { id: m.meeting.id, code: m.meeting.code, title: m.meeting.title, startedAt: m.meeting.startedAt, url: m.meeting.url, myName: m.meeting.myName || '', lineCount: 0, snapshotCount: 0, participants: [] };
        rec.status = 'live'; rec.tabId = tabId; rec.endedAt = null;
        if (m.meeting.title && !rec.renamed) rec.title = m.meeting.title;
        if (m.meeting.myName && !rec.myName) rec.myName = m.meeting.myName;
        await S.putMeeting(rec);
        live.set(tabId, { meetingId: rec.id, port, status: (cur && cur.status) || {} });
        saveLive();
        badge(tabId, true);
        broadcastState();
        return;
      }
      case 'lines': {
        if (!cur || m.meetingId !== cur.meetingId || !Array.isArray(m.lines)) return;
        await S.putLines(cur.meetingId, m.lines);
        const count = await S.countLines(cur.meetingId);
        const last = m.lines[m.lines.length - 1];
        await S.updateMeeting(cur.meetingId, (rec) => {
          rec.lineCount = count;
          if (last) rec.lastLine = { speaker: last.speaker, text: String(last.text).slice(-200) };
          rec.participants = addNames(rec.participants, m.lines.map((l) => l.speaker));
          return rec;
        });
        broadcast({ type: 'lines', meetingId: cur.meetingId, lines: m.lines });
        throttledState();
        return;
      }
      case 'snapshot': {
        if (!cur || m.meetingId !== cur.meetingId || !m.snapshot) return;
        await storeSnapshot(cur.meetingId, m.snapshot);
        return;
      }
      case 'meeting-update': {
        if (!cur || m.meetingId !== cur.meetingId) return;
        await S.updateMeeting(cur.meetingId, (rec) => { if (m.title && !rec.renamed) rec.title = m.title; if (m.myName && !rec.myName) rec.myName = m.myName; return rec; });
        throttledState();
        return;
      }
      case 'status': {
        if (cur) { cur.status = m; broadcast({ type: 'status', tabId, status: m }); }
        return;
      }
      case 'candidates': broadcast({ type: 'candidates', tabId, chosen: m.chosen, candidates: m.candidates }); return;
      case 'toast': broadcast({ type: 'toast', text: m.text }); return;
      case 'open-app': return openApp(m.meetingId || (cur && cur.meetingId) || null);
      case 'open-claude': if (m.meetingId) await openClaude(m.meetingId); return;
      case 'meeting-end': {
        if (!cur || m.meetingId !== cur.meetingId) return;
        // "page closed" also fires on a reload mid-call; the page comes back within seconds and says hello again.
        if (m.reason === 'page closed') scheduleEnd(tabId, cur.meetingId, m.reason, m.endedAt);
        else await endMeeting(tabId, m.endedAt || Date.now(), m.reason);
        return;
      }
      default: return;
    }
  }
}

function addNames(list, names) {
  const out = Array.isArray(list) ? list.slice() : [];
  for (const n of names) if (n && !out.includes(n)) out.push(n);
  return out.slice(0, 200);
}

async function storeSnapshot(meetingId, s) {
  const bytes = C.dataUrlToBytes(s.dataUrl);
  const key = await S.putSnapshot(meetingId, { takenAt: s.takenAt, reason: s.reason, source: s.source, width: s.width, height: s.height, format: s.format, bytes, thumb: s.thumb });
  const count = await S.countSnapshots(meetingId);
  await S.updateMeeting(meetingId, { snapshotCount: count });
  broadcast({ type: 'snapshot', meetingId, snapshot: { key, meetingId, takenAt: s.takenAt, reason: s.reason, source: s.source, width: s.width, height: s.height, size: bytes.byteLength, thumb: s.thumb } });
  throttledState();
}

function scheduleEnd(tabId, meetingId, reason, endedAt) {
  cancelEnd(meetingId);
  endTimers.set(meetingId, setTimeout(() => {
    endTimers.delete(meetingId);
    const still = live.get(tabId);
    if (still && still.meetingId === meetingId && !still.port) endMeeting(tabId, endedAt || Date.now(), reason);
  }, 8000));
}
function cancelEnd(meetingId) { const t = endTimers.get(meetingId); if (t) { clearTimeout(t); endTimers.delete(meetingId); } }

chrome.tabs.onRemoved.addListener((tabId) => { if (live.has(tabId)) endMeeting(tabId, Date.now(), 'tab closed'); });

async function endMeeting(tabId, endedAt, reason) {
  const cur = live.get(tabId);
  if (!cur) return;
  live.delete(tabId); saveLive(); badge(tabId, false);
  cancelEnd(cur.meetingId);
  const rec = await S.updateMeeting(cur.meetingId, (m) => { m.status = 'ended'; m.endedAt = endedAt; m.endReason = reason; m.tabId = null; return m; });
  broadcastState();
  await settingsReady;
  if (!rec || (rec.lineCount || 0) + (rec.snapshotCount || 0) === 0) return;
  const after = settings.afterCall;
  if (after === 'open' || after === 'both') openApp(cur.meetingId, { active: reason !== 'tab closed' });
  if (after === 'zip' || after === 'both') setTimeout(() => exportZip(cur.meetingId, { auto: true }), 1000);
  if (settings.openClaude) setTimeout(() => openClaude(cur.meetingId).catch(() => {}), 1500);
}

function badge(tabId, on) {
  chrome.action.setBadgeText({ tabId, text: on ? 'REC' : '' }).catch(() => {});
  if (on) chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc362e' }).catch(() => {});
}

/** Opens the captures page (or brings the open one forward), at one meeting when asked. */
async function openApp(meetingId, { active = true } = {}) {
  const url = APP_URL + (meetingId ? '#m=' + encodeURIComponent(meetingId) : '');
  const tabs = await chrome.tabs.query({ url: APP_URL + '*' }).catch(() => []);
  if (tabs.length) {
    const t = tabs[0];
    await chrome.tabs.update(t.id, { active, url }).catch(() => {});
    if (active) chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    if (meetingId) broadcast({ type: 'show', meetingId });
    return;
  }
  await chrome.tabs.create({ url, active });
}

// ------------------------------------------------------------------ the captures page
function appPort(port) {
  apps.add(port);
  port.onDisconnect.addListener(() => { void chrome.runtime.lastError; apps.delete(port); });
  port.onMessage.addListener((m) => { onApp(port, m).catch((e) => { console.warn('[MeetCapture]', e); safePost(port, { type: 'toast', text: String((e && e.message) || e) }); }); });
  settingsReady.then(() => sendState(port));
}

async function onApp(port, m) {
  if (!m || typeof m.type !== 'string') return;
  switch (m.type) {
    case 'state': return sendState(port);
    case 'snapshot-now': if (!forward(m.tabId, { type: 'snapshot-now' })) safePost(port, { type: 'toast', text: 'No live Meet call to snapshot.' }); return;
    case 'enable-captions': forward(m.tabId, { type: 'enable-captions' }); return;
    case 'candidates': forward(m.tabId, { type: 'candidates' }); return;
    case 'choose-source': forward(m.tabId, { type: 'choose-source', id: m.id }); return;
    case 'open-panel': forward(m.tabId, { type: 'open-panel' }); return;
    case 'focus-meet': { const e = [...live.entries()].find(([id, x]) => x.meetingId === m.meetingId); if (e) { const tab = await chrome.tabs.get(e[0]).catch(() => null); if (tab) { chrome.tabs.update(tab.id, { active: true }).catch(() => {}); chrome.windows.update(tab.windowId, { focused: true }).catch(() => {}); } } return; }
    case 'export': return exportZip(m.meetingId, { auto: false });
    case 'delete': await S.deleteMeeting(m.meetingId); return broadcastState();
    case 'delete-all': for (const x of await S.listMeetings(1000)) if (x.status !== 'live') await S.deleteMeeting(x.id); return broadcastState();
    case 'rename': { const title = C.normalize(m.title).slice(0, 120); if (title) await S.updateMeeting(m.meetingId, { title, renamed: true }); return broadcastState(); }
    case 'saved': await S.updateMeeting(m.meetingId, { savedAt: Date.now(), savedFolder: m.folder, savedPath: m.path }); return broadcastState();
    case 'open-claude': return openClaude(m.meetingId);
    case 'settings': await chrome.storage.local.set({ settings: C.settingsWithDefaults(m.settings) }); return;
    case 'usage': safePost(port, { type: 'usage', usage: await S.usage() }); return;
    case 'end-meeting': { for (const [tabId, e] of live) if (e.meetingId === m.meetingId) await endMeeting(tabId, Date.now(), 'ended from the captures page'); return; }
    default: return;
  }
}

function forward(tabId, msg) {
  let e = tabId != null ? live.get(tabId) : null;
  if (!e || !e.port) e = [...live.values()].find((x) => x.port);
  if (!e || !e.port) return false;
  try { e.port.postMessage(msg); return true; } catch (err) { return false; }
}

async function fullState() {
  await settingsReady;
  let meetings = [], error = '';
  try { meetings = await S.listMeetings(500); } catch (e) { error = 'Storage is not available: ' + String((e && e.message) || e); }
  const liveList = [...live.entries()].map(([tabId, e]) => ({ tabId, meetingId: e.meetingId, status: e.status, connected: !!e.port }));
  return { type: 'state', live: liveList, meetings, settings, exporting: [...exporting], error };
}
function safePost(port, m) { try { port.postMessage(m); } catch (e) { apps.delete(port); } }
function broadcast(m) { for (const p of apps) safePost(p, m); }
let stateTimer = null;
function throttledState() { if (stateTimer) return; stateTimer = setTimeout(() => { stateTimer = null; broadcastState(); }, 700); }
async function broadcastState() { if (!apps.size) return; const s = await fullState(); for (const p of apps) safePost(p, s); }
async function sendState(port) { safePost(port, await fullState()); }

// ------------------------------------------------------------------ keyboard shortcut
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'snapshot-now') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  forward(tab ? tab.id : null, { type: 'snapshot-now' });
});

// ------------------------------------------------------------------ the ZIP export
const OFFSCREEN_URL = 'offscreen/offscreen.html';
let creating = null;
async function ensureOffscreen() {
  if (creating) return creating;
  creating = (async () => {
    let has = false;
    try { has = await chrome.offscreen.hasDocument(); } catch (e) { has = false; }
    if (!has) {
      try { await chrome.offscreen.createDocument({ url: OFFSCREEN_URL, reasons: ['BLOBS'], justification: 'Build the meeting ZIP in memory and hand it to the downloads API' }); }
      catch (e) { if (!/already|exist/i.test(String(e && e.message))) throw e; }
    }
  })().finally(() => { creating = null; });
  return creating;
}

/** One ZIP with the transcript and the snapshots, saved as Downloads/Meet captures/<date time title>.zip. */
async function exportZip(meetingId, { auto } = {}) {
  await settingsReady;
  if (exporting.has(meetingId)) return;
  exporting.add(meetingId);
  broadcast({ type: 'exporting', meetingId });
  let urls = [];
  try {
    const rec = await S.getMeeting(meetingId);
    if (!rec) throw new Error('That meeting is no longer stored.');
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'build', meetingId, settings });
    if (!res) throw new Error('The export page did not answer.');
    if (res.error) throw new Error(res.error);
    urls = [res.url];
    const id = await chrome.downloads.download({ url: res.url, filename: res.filename, conflictAction: 'uniquify', saveAs: false });
    const item = await waitDownload(id);
    await S.updateMeeting(meetingId, { zipAt: Date.now(), zipFile: res.filename, zipPath: item.filename || res.filename, zipBytes: res.size });
    broadcast({ type: 'exported', meetingId, file: res.filename, path: item.filename || res.filename, downloadId: id, auto: !!auto });
  } catch (e) {
    broadcast({ type: 'export-failed', meetingId, error: String((e && e.message) || e) });
  } finally {
    exporting.delete(meetingId);
    if (urls.length) chrome.runtime.sendMessage({ target: 'offscreen', type: 'release', urls }).catch(() => {});
    broadcastState();
    if (!exporting.size) chrome.offscreen.closeDocument().catch(() => {});
  }
}

function waitDownload(id) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); chrome.downloads.onChanged.removeListener(on); fn(v); };
    const timer = setTimeout(() => finish(reject, new Error('The download took too long.')), 180000);
    function on(d) {
      if (d.id !== id || !d.state) return;
      if (d.state.current === 'complete') chrome.downloads.search({ id }).then((items) => finish(resolve, items[0] || {}));
      else if (d.state.current === 'interrupted') finish(reject, new Error('Chrome interrupted the download' + (d.error ? ` (${d.error.current})` : '') + '.'));
    }
    chrome.downloads.onChanged.addListener(on);
    chrome.downloads.search({ id }).then((items) => { // it may have finished before the listener was attached
      const it = items[0];
      if (it && it.state === 'complete') finish(resolve, it);
      else if (it && it.state === 'interrupted') finish(reject, new Error('Chrome interrupted the download' + (it.error ? ` (${it.error})` : '') + '.'));
    }).catch(() => {});
  });
}

async function markdownFor(meetingId) {
  await settingsReady;
  const [meeting, lines, snapshots] = await Promise.all([S.getMeeting(meetingId), S.getLines(meetingId), S.getSnapshots(meetingId)]);
  if (!meeting) throw new Error('That meeting is no longer stored.');
  return C.buildMarkdown({ meeting, lines, snapshots, settings });
}

const CLAUDE_NEW = 'https://claude.ai/new';
const CLAUDE_PREFILL_MAX = 60000; // characters; longer transcripts are pasted by hand (the page copies them)
async function openClaude(meetingId) {
  const text = await markdownFor(meetingId);
  const fits = text.length <= CLAUDE_PREFILL_MAX;
  await chrome.tabs.create({ url: fits ? `${CLAUDE_NEW}?q=${encodeURIComponent(text)}` : CLAUDE_NEW });
  broadcast({ type: 'claude-opened', meetingId, fits });
  return fits;
}
