// Runs on meet.google.com. Notices when you are in a call, reads the captions Meet draws on the page,
// snapshots the shared screen, and streams all of it to the extension's service worker over a port.
// Nothing is sent anywhere else. The page itself is never changed, apart from a small status pill.
(() => {
  const C = window.MCC;
  if (!C || window.__meetCaptureLoaded) return;
  window.__meetCaptureLoaded = true;

  let settings = C.settingsWithDefaults(null);
  const LOG = (...a) => { if (settings.debug) console.log('[MeetCapture]', ...a); };

  const state = {
    inCall: false, missing: 0, meeting: null,
    region: null, strategy: '', observer: null, transcript: null, keys: new WeakMap(), nextKey: 1,
    captionsOn: null, ccAttempts: 0, ccLastTry: 0,
    lineCount: 0, snapshotCount: 0, lastLines: [],
    source: null, chosenSource: 'auto', candidates: [],
    pending: new Map(), flushTimer: null, outbox: [],
  };
  const detector = C.createChangeDetector();
  const sigCanvas = document.createElement('canvas');

  // ------------------------------------------------------------------ settings
  function applySettings(s) {
    settings = C.settingsWithDefaults(s);
    detector.configure({
      threshold: C.THRESHOLDS[settings.snapshotSensitivity] || C.THRESHOLDS.normal,
      timerMs: settings.snapshotMode === 'timer' || settings.snapshotMode === 'both' ? Math.max(10, settings.snapshotEverySec) * 1000 : 0,
    });
    renderPill();
  }
  chrome.storage.local.get('settings').then((r) => applySettings(r.settings)).catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.settings) applySettings(ch.settings.newValue); });

  // ------------------------------------------------------------------ the port to the service worker
  let port = null, reconnectTimer = null;
  function connect() {
    if (!chrome.runtime?.id) return; // the extension was reloaded; this copy of the script is orphaned
    try { port = chrome.runtime.connect({ name: 'content' }); } catch (e) { port = null; return scheduleReconnect(); }
    port.onMessage.addListener(onBackgroundMessage);
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; port = null; scheduleReconnect(); });
    if (state.meeting) {
      send({ type: 'hello', meeting: meetingInfo() });
      // Lines sent while the worker was asleep are re-sent: they are upserts, so nothing doubles.
      for (const m of state.outbox.splice(0)) send(m);
      flushLines(true);
      sendStatus();
    }
  }
  function scheduleReconnect() {
    if (reconnectTimer || !chrome.runtime?.id) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 1000);
  }
  function send(m) {
    if (!port) { if (m.type === 'snapshot' && state.outbox.length < 12) state.outbox.push(m); return false; }
    try { port.postMessage(m); return true; } catch (e) { return false; }
  }

  function onBackgroundMessage(m) {
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'snapshot-now') return snapshotNow('manual');
    if (m.type === 'enable-captions') { state.ccAttempts = 0; state.ccLastTry = 0; return enableCaptions(true); }
    if (m.type === 'candidates') return sendCandidates();
    if (m.type === 'choose-source') { state.chosenSource = m.id || 'auto'; detector.reset(); return sendStatus(); }
    if (m.type === 'status') return sendStatus();
  }

  // ------------------------------------------------------------------ the call
  const CALL_END_SYMBOL = /^call_end$/;
  function findLeaveControl() {
    const byLabel = document.querySelector('button[aria-label*="leave call" i], [role="button"][aria-label*="leave call" i], button[aria-label*="end call" i], [data-tooltip*="leave call" i]');
    if (byLabel) return byLabel;
    for (const i of document.querySelectorAll('.google-symbols, .google-material-icons, i')) {
      if (CALL_END_SYMBOL.test(i.textContent.trim())) return i.closest('button, [role="button"]') || i;
    }
    return null;
  }
  const codeFromUrl = () => (location.pathname.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i) || [])[1] || location.pathname.split('/').filter(Boolean).slice(-1)[0] || 'meet';
  function readTitle() {
    const attr = document.querySelector('[data-meeting-title]');
    if (attr) { const t = C.normalize(attr.getAttribute('data-meeting-title')); if (t) return t; }
    const t = C.normalize(document.title).replace(/\s*[-–|]\s*Google Meet\s*$/i, '').replace(/^Meet\s*[-–]\s*/i, '');
    if (t && !/^google meet$/i.test(t)) return t;
    const el = document.querySelector('.u6vdEc');
    return (el && C.normalize(el.textContent)) || codeFromUrl();
  }
  function readMyName() {
    const el = document.querySelector('[data-self-name]');
    return el ? C.normalize(el.getAttribute('data-self-name') || el.textContent).slice(0, 80) : '';
  }
  function meetingInfo() {
    const m = state.meeting;
    return m && { id: m.id, code: m.code, title: m.title, startedAt: m.startedAt, url: m.url, myName: m.myName || '' };
  }

  const SESSION_KEY = 'meet-capture-meeting';
  function enterCall() {
    const code = codeFromUrl();
    let m = null;
    try { // after a page reload during a call, continue the same meeting instead of starting a second one
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (saved && saved.code === code && Date.now() - saved.startedAt < 8 * 3600e3) m = saved;
    } catch (e) { /* no session storage */ }
    if (!m) m = { id: `${code}-${Date.now().toString(36)}`, code, title: readTitle(), startedAt: Date.now(), url: location.href.split('?')[0], myName: readMyName() };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(m)); } catch (e) { /* fine */ }
    Object.assign(state, { inCall: true, missing: 0, meeting: m, region: null, strategy: '', transcript: C.createTranscript(), keys: new WeakMap(), captionsOn: null, ccAttempts: 0, ccLastTry: 0, lineCount: 0, snapshotCount: 0, lastLines: [], source: null, chosenSource: 'auto' });
    state.pending.clear(); state.outbox.length = 0; detector.reset();
    send({ type: 'meeting-start', meeting: meetingInfo() });
    LOG('call started', m);
    sendStatus();
  }
  function leaveCall(reason) {
    if (!state.inCall) return;
    flushLines(true);
    detach();
    send({ type: 'meeting-end', meetingId: state.meeting.id, endedAt: Date.now(), reason });
    // A reload mid-call fires pagehide too; the key stays so the reloaded page continues the same meeting.
    if (reason !== 'page closed') { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* fine */ } }
    LOG('call ended', reason);
    state.inCall = false; state.meeting = null; state.source = null; state.candidates = [];
    renderPill();
  }
  window.addEventListener('pagehide', () => leaveCall('page closed'));

  // ------------------------------------------------------------------ captions on/off
  const CC_SYMBOL = /^closed_caption(_off)?$/;
  const CC_LABEL = new RegExp(C.CAPTION_LABEL_WORDS.join('|'), 'i');
  function findCaptionsButton() {
    for (const b of document.querySelectorAll('button[aria-label], [role="button"][aria-label]')) {
      if (CC_LABEL.test(b.getAttribute('aria-label')) && !b.closest('[role="dialog"], [role="menu"]')) return b;
    }
    for (const i of document.querySelectorAll('.google-symbols, i')) {
      if (CC_SYMBOL.test(i.textContent.trim())) { const b = i.closest('button, [role="button"]'); if (b) return b; }
    }
    return null;
  }
  function isCaptionsOn(btn) {
    const pressed = btn.getAttribute('aria-pressed');
    if (pressed != null) return pressed === 'true';
    const sym = [...btn.querySelectorAll('.google-symbols, i')].map((i) => i.textContent.trim()).find((t) => CC_SYMBOL.test(t));
    if (sym) return sym === 'closed_caption';
    return /\b(off|turn off|disable|ausschalten|désactiver)\b/i.test(btn.getAttribute('aria-label') || '');
  }
  function enableCaptions(force) {
    const btn = findCaptionsButton();
    if (!btn) return false;
    if (isCaptionsOn(btn)) { state.captionsOn = true; return true; }
    const now = Date.now();
    if (!force && (state.ccAttempts >= 3 || now - state.ccLastTry < 6000)) return false;
    state.ccAttempts++; state.ccLastTry = now;
    btn.click();
    LOG('clicked the captions button');
    return true;
  }
  function checkCaptions() {
    const btn = findCaptionsButton();
    state.captionsOn = btn ? isCaptionsOn(btn) : null;
    if (btn && !state.captionsOn && settings.autoCaptions && !state.region) enableCaptions(false);
  }

  // ------------------------------------------------------------------ captions region
  function checkRegion() {
    if (state.region && state.region.isConnected) return;
    const found = C.findRegion(document);
    if (!found) { if (state.region) detach(); return; }
    attach(found.region, found.strategy);
  }
  function attach(region, strategy) {
    detach();
    state.region = region; state.strategy = strategy;
    state.observer = new MutationObserver(scheduleScan);
    state.observer.observe(region, { childList: true, subtree: true, characterData: true });
    LOG('captions region found by', strategy);
    scan();
    sendStatus();
  }
  function detach() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    if (state.region && state.transcript) for (const key of state.transcript.boundKeys()) { const e = state.transcript.release(key); if (e) queueLine(e); }
    state.region = null; state.strategy = '';
  }
  let scanTimer = null;
  function scheduleScan() { if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 60); }
  function scan() {
    if (!state.region || !state.transcript) return;
    if (!state.region.isConnected) { detach(); return; }
    const seen = new Set();
    for (const el of C.items(state.region)) {
      const r = C.readItem(el);
      if (!r) continue;
      let key = state.keys.get(el);
      if (!key) { key = state.nextKey++; state.keys.set(el, key); }
      seen.add(key);
      const { entry, changed } = state.transcript.upsert(key, r.speaker, r.text); // the speaker as Meet shows it; "You" is renamed at export time
      if (changed) queueLine(entry);
    }
    for (const key of state.transcript.boundKeys()) if (!seen.has(key)) { const e = state.transcript.release(key); if (e) queueLine(e); }
  }
  function queueLine(e) {
    state.pending.set(e.id, e);
    if (!state.flushTimer) state.flushTimer = setTimeout(() => flushLines(false), 400);
  }
  function flushLines(now) {
    if (state.flushTimer) { clearTimeout(state.flushTimer); state.flushTimer = null; }
    if (!state.meeting) { state.pending.clear(); return; }
    const all = state.transcript ? state.transcript.all() : [];
    state.lineCount = all.filter((e) => e.full).length;
    state.lastLines = all.filter((e) => e.full).slice(-3).map((e) => ({ speaker: C.speakerAlias(e.speaker, settings.myName || state.meeting.myName), text: e.full.slice(-160) }));
    const lines = now ? all.filter((e) => e.full) : [...state.pending.values()].filter((e) => e.full);
    state.pending.clear();
    if (lines.length) send({ type: 'lines', meetingId: state.meeting.id, lines: lines.map((e) => ({ id: e.id, speaker: e.speaker, text: e.full, startedAt: e.startedAt, updatedAt: e.updatedAt, final: e.final })) });
    renderPill();
  }

  // ------------------------------------------------------------------ snapshots
  function pickSource() {
    const cands = C.candidates(document, window);
    state.candidates = cands;
    if (state.chosenSource !== 'auto') return cands.find((c) => c.id === state.chosenSource) || null;
    return cands.find((c) => c.likely && !c.self) || null;
  }
  function sampleSnapshots() {
    if (!state.inCall) return;
    const pick = pickSource();
    const changedSource = (pick && pick.id) !== (state.source && state.source.id);
    state.source = pick;
    if (changedSource) sendStatus();
    if (!pick || settings.snapshotMode === 'manual') return;
    let sig;
    try { sig = C.signatureOf(pick.video, sigCanvas); } catch (e) { return; }
    const reason = detector.sample(sig, pick.id);
    if (!reason) return;
    const mode = settings.snapshotMode;
    if (reason === 'timer' && mode === 'change') return;
    if ((reason === 'screen changed' || reason === 'new source') && mode === 'timer') return;
    takeSnapshot(pick, reason, sig);
  }
  function takeSnapshot(pick, reason, sig) {
    let shot;
    try { shot = C.capture(pick.video, { maxWidth: settings.snapshotMaxWidth, format: settings.snapshotFormat, quality: 0.9, doc: document }); } catch (e) { LOG('snapshot failed', e); return false; }
    try { detector.saved(sig || C.signatureOf(pick.video, sigCanvas)); } catch (e) { /* fine */ }
    state.snapshotCount++;
    send({ type: 'snapshot', meetingId: state.meeting.id, snapshot: { takenAt: Date.now(), reason, source: pick.label || (pick.presenting ? 'Presentation' : 'Shared screen'), width: shot.width, height: shot.height, format: shot.format, dataUrl: shot.dataUrl, thumb: shot.thumb } });
    flashPill();
    renderPill();
    return true;
  }
  function snapshotNow(reason) {
    if (!state.inCall) return send({ type: 'toast', text: 'Not in a call.' });
    const pick = pickSource() || state.candidates[0];
    if (!pick) return send({ type: 'toast', text: 'No video to snapshot. Is someone sharing a screen?' });
    if (!takeSnapshot(pick, reason)) send({ type: 'toast', text: 'That snapshot did not work.' });
  }
  function sendCandidates() {
    const cands = C.candidates(document, window);
    state.candidates = cands;
    const list = cands.map((c) => {
      let thumb = '';
      try { thumb = C.capture(c.video, { maxWidth: 240, format: 'jpeg', quality: 0.6, doc: document }).dataUrl; } catch (e) { /* tainted or not ready */ }
      return { id: c.id, label: c.label, width: c.width, height: c.height, presenting: c.presenting, self: c.self, likely: c.likely, thumb };
    });
    send({ type: 'candidates', meetingId: state.meeting && state.meeting.id, chosen: state.chosenSource, candidates: list });
  }

  // ------------------------------------------------------------------ status for the panel
  let statusTimer = null;
  function sendStatus() {
    if (statusTimer) return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      if (!state.meeting) return send({ type: 'status', inCall: false });
      const s = state.source;
      send({ type: 'status', inCall: true, meetingId: state.meeting.id, title: state.meeting.title, captionsOn: state.captionsOn, regionFound: !!state.region, strategy: state.strategy, lineCount: state.lineCount, snapshotCount: state.snapshotCount, lastLines: state.lastLines, chosenSource: state.chosenSource, source: s ? { id: s.id, label: s.label, width: s.width, height: s.height, presenting: s.presenting, likely: s.likely } : null, videos: state.candidates.length });
    }, 150);
  }

  // ------------------------------------------------------------------ the status pill on the page
  let pill = null, pillBody = null, pillFlash = null;
  function ensurePill() {
    if (pill) return;
    pill = document.createElement('div');
    pill.id = 'meet-capture-pill';
    const root = pill.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host{all:initial;position:fixed;top:14px;left:14px;z-index:2147483000;font:12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;pointer-events:none}
      .p{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 10px;border-radius:999px;background:rgba(18,22,26,.86);color:#E8EDF0;box-shadow:0 2px 10px rgba(0,0,0,.35);backdrop-filter:blur(6px);pointer-events:auto;transition:box-shadow .2s}
      .p.flash{box-shadow:0 0 0 3px #4CC9A8,0 2px 10px rgba(0,0,0,.35)}
      .dot{width:8px;height:8px;border-radius:50%;background:#E0533E;box-shadow:0 0 0 0 rgba(224,83,62,.6);animation:pulse 1.6s ease-out infinite}
      .dot.off{background:#9AA3A8;animation:none}
      @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(224,83,62,.6)}100%{box-shadow:0 0 0 8px rgba(224,83,62,0)}}
      .t{white-space:nowrap}
      button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;background:#4CC9A8;color:#0B1F19;font:600 12px system-ui,sans-serif}
      button:hover{background:#6ADBBE}button:focus-visible{outline:2px solid #fff}
      @media (prefers-reduced-motion:reduce){.dot{animation:none}}
    </style><div class="p" role="status" aria-live="polite"><span class="dot"></span><span class="t"></span><button type="button" title="Snapshot the shared screen (Alt+Shift+S)">📷 Snapshot</button></div>`;
    pillBody = root.querySelector('.t'); pillFlash = root.querySelector('.p');
    root.querySelector('button').addEventListener('click', (e) => { if (e.isTrusted) snapshotNow('manual'); });
    (document.body || document.documentElement).appendChild(pill);
  }
  function renderPill() {
    if (!state.inCall || !settings.showPill) { if (pill) pill.remove(), pill = null; return; }
    ensurePill();
    if (!pill.isConnected) (document.body || document.documentElement).appendChild(pill);
    const cc = state.region ? '' : state.captionsOn === false ? ' · captions off' : ' · waiting for captions';
    pillBody.textContent = `Capturing · ${state.lineCount} line${state.lineCount === 1 ? '' : 's'} · ${state.snapshotCount} snapshot${state.snapshotCount === 1 ? '' : 's'}${cc}`;
    pillFlash.querySelector('.dot').classList.toggle('off', !state.region);
  }
  function flashPill() {
    if (!pillFlash) return;
    pillFlash.classList.add('flash');
    setTimeout(() => pillFlash && pillFlash.classList.remove('flash'), 600);
  }

  // ------------------------------------------------------------------ the loop
  function tick() {
    if (!chrome.runtime?.id) { clearInterval(loop); clearInterval(snapLoop); clearInterval(pollLoop); return; }
    const leave = findLeaveControl();
    if (leave) { state.missing = 0; if (!state.inCall) enterCall(); }
    else if (state.inCall && ++state.missing >= 3) leaveCall('left the call');
    if (!state.inCall) return;
    checkCaptions();
    checkRegion();
    const title = readTitle();
    if (title && title !== state.meeting.title && title !== state.meeting.code) { state.meeting.title = title; send({ type: 'meeting-update', meetingId: state.meeting.id, title }); try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.meeting)); } catch (e) { /* fine */ } }
    if (!state.meeting.myName) { const n = readMyName(); if (n) { state.meeting.myName = n; send({ type: 'meeting-update', meetingId: state.meeting.id, myName: n }); } }
    sendStatus();
  }
  const loop = setInterval(tick, 1500);
  const snapLoop = setInterval(sampleSnapshots, 2000);
  const pollLoop = setInterval(() => { if (state.region) scan(); }, 1000); // belt and braces for a missed mutation
  connect();
  tick();
})();
