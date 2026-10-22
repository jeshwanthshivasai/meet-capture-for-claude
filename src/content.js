// Runs on meet.google.com. Notices when you are in a call, reads the captions Meet draws on the page,
// snapshots the shared screen, streams all of it to the extension's service worker over a port, and
// drives the capture UI inside Meet (src/ui.js). Nothing is sent anywhere else.
(() => {
  const C = window.MCC;
  if (!C || window.__meetCaptureLoaded) return;
  window.__meetCaptureLoaded = true;

  let settings = C.settingsWithDefaults(null);
  const LOG = (...a) => { if (settings.debug) console.log('[MeetCapture]', ...a); };

  const state = {
    inCall: false, missing: 0, meeting: null, ready: false, firstUpdate: true,
    region: null, strategy: '', observer: null, transcript: null, keys: new WeakMap(), nextKey: 1, avatars: new Map(),
    captionsOn: null, ccAttempts: 0, ccLastTry: 0,
    lineCount: 0, snapshotCount: 0, lines: [], snapshots: [], lastStats: null,
    source: null, chosenSource: 'auto', candidates: [], share: null, selfPresenting: false,
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
    renderUI();
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
    if (m.type === 'open-panel') return ui.setOpen(true);
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
  let nameHint = ''; // the name seen on the lobby page, where Meet still shows the account button
  function readMyName() {
    const el = document.querySelector('[data-self-name]');
    if (el) { const n = C.normalize(el.getAttribute('data-self-name') || el.textContent).slice(0, 80); if (n && !C.SELF_WORDS.test(n)) return n; }
    // Google's account button: aria-label "Google Account: Name (email)".
    const acct = document.querySelector('a[aria-label^="Google Account" i], [role="button"][aria-label^="Google Account" i]');
    if (acct) { const m = /:\s*([^(\n]+?)\s*(?:\(|\n|$)/.exec(acct.getAttribute('aria-label') || ''); if (m) return C.normalize(m[1]).slice(0, 80); }
    return nameHint;
  }
  /** Is the user sharing their own screen? Meet then shows a "Stop presenting" control. */
  function isSelfPresenting() {
    for (const b of document.querySelectorAll('button[aria-label], [role="button"][aria-label], [data-tooltip]')) {
      if (/stop (presenting|sharing)/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-tooltip') || ''))) return true;
    }
    return false;
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
    if (!m) {
      m = { id: `${code}-${Date.now().toString(36)}`, code, title: readTitle(), startedAt: Date.now(), url: location.href.split('?')[0], myName: readMyName() };
      try { sessionStorage.removeItem('meet-capture-panel-open'); } catch (e) { /* fine */ } // a new call starts with the panel as the setting says
    }
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(m)); } catch (e) { /* fine */ }
    Object.assign(state, { inCall: true, missing: 0, meeting: m, ready: false, firstUpdate: true, region: null, strategy: '', transcript: C.createTranscript(), keys: new WeakMap(), avatars: new Map(), captionsOn: null, ccAttempts: 0, ccLastTry: 0, lineCount: 0, snapshotCount: 0, lines: [], snapshots: [], source: null, chosenSource: 'auto', selfPresenting: false });
    state.pending.clear(); state.outbox.length = 0; detector.reset();
    ui.hideAfterCall();
    send({ type: 'meeting-start', meeting: meetingInfo() });
    LOG('call started', m);
    setTimeout(() => { state.ready = true; renderUI(); }, 400); // let Meet finish drawing its bar before ours joins it
    sendStatus();
  }
  function leaveCall(reason) {
    if (!state.inCall) return;
    flushLines(true);
    detach();
    stopShare();
    const info = { lineCount: state.lineCount, snapshotCount: state.snapshotCount, duration: Date.now() - state.meeting.startedAt, captured: state.lineCount + state.snapshotCount > 0 };
    const meetingId = state.meeting.id;
    send({ type: 'meeting-end', meetingId, endedAt: Date.now(), reason });
    // A reload mid-call fires pagehide too; the key stays so the reloaded page continues the same meeting.
    if (reason !== 'page closed') { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* fine */ } }
    LOG('call ended', reason);
    state.inCall = false; state.meeting = null; state.source = null; state.candidates = []; state.ready = false;
    renderUI();
    if (reason === 'left the call') ui.showAfterCall(info, { openApp: () => send({ type: 'open-app', meetingId }), openClaude: () => send({ type: 'open-claude', meetingId }) });
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
      if (!state.avatars.has(r.speaker)) { const img = el.querySelector('img[src^="https://"]'); if (img) state.avatars.set(r.speaker, img.src); }
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
    const tr = state.transcript;
    const all = tr ? tr.allLines() : [];
    state.lineCount = all.length;
    const me = settings.myName || state.meeting.myName;
    const lastOfEntry = new Map(); // only the newest segment of a block is still being written
    for (const l of all) lastOfEntry.set(String(l.id).split('.')[0], l.id);
    state.lines = all.map((l) => ({ id: l.id, speaker: C.speakerAlias(l.speaker, me), text: l.text, startedAt: l.startedAt, final: l.final || lastOfEntry.get(String(l.id).split('.')[0]) !== l.id, avatar: state.avatars.get(l.speaker) || '' }));
    const lines = now ? all : [...state.pending.values()].flatMap((e) => tr.lines(e));
    state.pending.clear();
    if (lines.length) send({ type: 'lines', meetingId: state.meeting.id, lines });
    renderUI();
  }

  // ------------------------------------------------------------------ snapshots
  function pickSource() {
    const cands = C.candidates(document, window);
    if (state.share) cands.unshift(state.share.candidate);
    state.candidates = cands;
    if (state.chosenSource !== 'auto') return cands.find((c) => c.id === state.chosenSource) || null;
    return cands.find((c) => c.likely && !c.self) || null;
  }
  function sampleSnapshots() {
    if (!state.inCall) return;
    const pick = pickSource();
    const changedSource = (pick && pick.id) !== (state.source && state.source.id);
    state.source = pick;
    if (changedSource) { sendStatus(); renderUI(); }
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
    const takenAt = Date.now();
    const source = pick.label || (pick.presenting ? 'Presentation' : 'Shared screen');
    state.snapshots.push({ n: state.snapshotCount, takenAt, reason, thumb: shot.thumb });
    if (state.snapshots.length > 300) state.snapshots.shift();
    send({ type: 'snapshot', meetingId: state.meeting.id, snapshot: { takenAt, reason, source, width: shot.width, height: shot.height, format: shot.format, dataUrl: shot.dataUrl, thumb: shot.thumb } });
    ui.flash();
    renderUI();
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
    if (state.share) cands.unshift(state.share.candidate);
    state.candidates = cands;
    const list = cands.map((c) => {
      let thumb = '';
      try { thumb = C.capture(c.video, { maxWidth: 240, format: 'jpeg', quality: 0.6, doc: document }).dataUrl; } catch (e) { /* tainted or not ready */ }
      return { id: c.id, label: c.label, width: c.width, height: c.height, presenting: c.presenting, self: c.self, likely: c.likely, thumb };
    });
    send({ type: 'candidates', meetingId: state.meeting && state.meeting.id, chosen: state.chosenSource, candidates: list });
  }

  /** Your own share has no preview in Meet; Chrome's picker gives us the same picture to watch. */
  async function captureShare() {
    if (!state.inCall || state.share) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'exclude' });
    } catch (e) { LOG('share capture cancelled', e); return; }
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay rules do not apply to muted video */ }
    const candidate = { video, id: 'share', width: video.videoWidth, height: video.videoHeight, area: 1e9, label: 'Your screen share', presenting: true, self: false, mirrored: false, likely: true };
    state.share = { stream, video, candidate };
    const [track] = stream.getVideoTracks();
    if (track) track.addEventListener('ended', stopShare);
    detector.reset();
    sendStatus(); renderUI();
    setTimeout(() => { candidate.width = video.videoWidth; candidate.height = video.videoHeight; sampleSnapshots(); }, 600);
  }
  function stopShare() {
    if (!state.share) return;
    try { for (const t of state.share.stream.getTracks()) t.stop(); } catch (e) { /* fine */ }
    state.share = null;
    if (state.chosenSource === 'share') state.chosenSource = 'auto';
    sendStatus(); renderUI();
  }

  // ------------------------------------------------------------------ status for the service worker and the captures page
  let statusTimer = null;
  function sendStatus() {
    if (statusTimer) return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      if (!state.meeting) return send({ type: 'status', inCall: false });
      const s = state.source;
      send({ type: 'status', inCall: true, meetingId: state.meeting.id, title: state.meeting.title, captionsOn: state.captionsOn, regionFound: !!state.region, strategy: state.strategy, lineCount: state.lineCount, snapshotCount: state.snapshotCount, chosenSource: state.chosenSource, selfPresenting: !!state.selfPresenting, shareActive: !!state.share, source: s ? { id: s.id, label: s.label, width: s.width, height: s.height, presenting: s.presenting, likely: s.likely } : null, videos: state.candidates.length });
    }, 150);
  }

  // ------------------------------------------------------------------ the UI inside Meet
  const ui = C.createMeetUI({
    snapshot: () => snapshotNow('manual'),
    setMode: (mode) => { if (['change', 'both', 'timer', 'manual'].includes(mode)) chrome.storage.local.set({ settings: { ...settings, snapshotMode: mode } }).catch(() => {}); },
    chooseSource: (id) => { state.chosenSource = id || 'auto'; detector.reset(); sendStatus(); renderUI(); },
    captureShare,
    enableCaptions: () => { state.ccAttempts = 0; state.ccLastTry = 0; enableCaptions(true); },
    openApp: () => send({ type: 'open-app', meetingId: state.meeting && state.meeting.id }),
    toggled: () => {},
  });
  let uiTimer = null;
  function renderUI() {
    if (uiTimer) return;
    uiTimer = setTimeout(() => {
      uiTimer = null;
      if (!state.inCall) { ui.update({ inCall: false }); return; }
      const s = state.source;
      ui.update({
        inCall: true, ready: state.ready, firstUpdate: state.firstUpdate, openByDefault: settings.openPanel,
        elapsed: Date.now() - state.meeting.startedAt, lineCount: state.lineCount, snapshotCount: state.snapshotCount,
        lines: state.lines, snapshots: state.snapshots, captionsOn: state.captionsOn, regionFound: !!state.region,
        mode: settings.snapshotMode, chosenSource: state.chosenSource, selfPresenting: state.selfPresenting, shareActive: !!state.share,
        source: s ? { id: s.id, label: s.label, presenting: s.presenting, likely: s.likely } : null,
        candidates: state.candidates.map((c) => ({ id: c.id, label: c.label, width: c.width, height: c.height, presenting: c.presenting, self: c.self })),
      });
      if (state.ready) state.firstUpdate = false;
    }, 120);
  }
  // Meet shows one side panel at a time; ours steps aside when one of Meet's opens.
  document.addEventListener('click', (e) => {
    if (!ui.isOpen()) return;
    const b = e.target.closest && e.target.closest('button[aria-label], [role="button"][aria-label]');
    if (b && !b.closest('#meet-capture-button') && /chat with everyone|^chat$|in-call messages|show everyone|^people$|participants|activities|meeting details|host controls/i.test(b.getAttribute('aria-label') || '')) ui.setOpen(false);
  }, true);

  // ------------------------------------------------------------------ the loop
  function tick() {
    if (!chrome.runtime?.id) { clearInterval(loop); clearInterval(snapLoop); clearInterval(pollLoop); ui.destroy(); return; }
    const leave = findLeaveControl();
    if (leave) { state.missing = 0; if (!state.inCall) enterCall(); }
    else if (state.inCall && ++state.missing >= 3) leaveCall('left the call');
    if (!state.inCall) { const n = readMyName(); if (n) nameHint = n; return; }
    const presenting = isSelfPresenting();
    if (presenting !== !!state.selfPresenting) { state.selfPresenting = presenting; if (!presenting) stopShare(); }
    checkCaptions();
    checkRegion();
    const title = readTitle();
    if (title && title !== state.meeting.title && title !== state.meeting.code) { state.meeting.title = title; send({ type: 'meeting-update', meetingId: state.meeting.id, title }); try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.meeting)); } catch (e) { /* fine */ } }
    if (!state.meeting.myName) { const n = readMyName(); if (n) { state.meeting.myName = n; send({ type: 'meeting-update', meetingId: state.meeting.id, myName: n }); } }
    sendStatus();
    renderUI();
  }
  const loop = setInterval(tick, 1500);
  const snapLoop = setInterval(sampleSnapshots, 800);
  const pollLoop = setInterval(() => { if (state.region) scan(); }, 1000); // belt and braces for a missed mutation
  connect();
  tick();
})();
