// The side panel. It talks to the extension's service worker over a port: the live call, the captured
// lines and snapshots, past meetings, exports and settings all come from there. It can also capture
// your own screen share (getDisplayMedia) when Meet does not show it as a video on the page.
(() => {
  const C = window.MCC;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = C.esc;
  const view = $('#view'), toastEl = $('#toast'), settingsBtn = $('#settings-btn');
  const VERSION = chrome.runtime.getManifest().version;
  const REPO = 'https://github.com/jeshwanthshivasai/meet-capture-for-claude';

  const state = {
    live: [], meetings: [], settings: C.settingsWithDefaults(null), exporting: [], error: '',
    statuses: new Map(), lines: new Map(), snaps: new Map(), loaded: new Set(),
    candidates: null, exported: new Map(), display: null, showSettings: false, usage: null, confirmDelete: null,
  };

  // ------------------------------------------------------------------ port
  let port = null;
  function connect() {
    try { port = chrome.runtime.connect({ name: 'panel' }); } catch (e) { return; }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; port = null; setTimeout(connect, 800); });
  }
  const send = (m) => { if (port) { try { port.postMessage(m); } catch (e) { /* reconnecting */ } } };

  function onMessage(m) {
    if (!m || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'state':
        state.live = m.live || []; state.meetings = m.meetings || []; state.settings = C.settingsWithDefaults(m.settings);
        state.exporting = m.exporting || []; state.error = m.error || '';
        for (const l of state.live) {
          if (l.status && l.status.inCall) state.statuses.set(l.tabId, l.status);
          if (!state.loaded.has(l.meetingId)) { state.loaded.add(l.meetingId); send({ type: 'lines', meetingId: l.meetingId }); send({ type: 'snapshots', meetingId: l.meetingId }); }
        }
        if (!state.live.length && state.display) stopDisplay();
        render(); break;
      case 'status': state.statuses.set(m.tabId, m.status); patchLive(); break;
      case 'lines': { const map = linesFor(m.meetingId); for (const l of m.lines) map.set(l.id, l); patchLive(); break; }
      case 'lines-all': { const map = new Map(); for (const l of m.lines) map.set(l.id, l); state.lines.set(m.meetingId, map); render(); break; }
      case 'snapshot': { const arr = state.snaps.get(m.meetingId) || []; arr.push(m.snapshot); state.snaps.set(m.meetingId, arr); render(); break; }
      case 'snapshots-all': state.snaps.set(m.meetingId, m.snapshots || []); render(); break;
      case 'candidates': state.candidates = { tabId: m.tabId, chosen: m.chosen, list: m.candidates || [] }; render(); break;
      case 'exporting': toast('Exporting…'); break;
      case 'exported': state.exported.set(m.meetingId, m); toast(`Saved to Downloads/${m.folder}`); render(); break;
      case 'export-failed': toast('Export failed: ' + m.error, true); render(); break;
      case 'markdown': copyText(m.text); break;
      case 'toast': toast(m.text); break;
      case 'settings': state.settings = C.settingsWithDefaults(m.settings); if (!state.showSettings) render(); break;
      case 'usage': state.usage = m.usage; { const u = $('#usage'); if (u) u.textContent = usageText(); } break;
      default: break;
    }
  }
  const linesFor = (id) => { let map = state.lines.get(id); if (!map) { map = new Map(); state.lines.set(id, map); } return map; };

  // ------------------------------------------------------------------ rendering
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const byTime = (a, b) => (a.startedAt - b.startedAt) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  const meetingOf = (id) => state.meetings.find((x) => x.id === id) || {};

  function render() {
    settingsBtn.setAttribute('aria-pressed', String(state.showSettings));
    if (state.showSettings) { view.innerHTML = settingsView(); afterSettings(); return; }
    const parts = [];
    if (state.error) parts.push(`<div class="card error">${esc(state.error)}</div>`);
    const l = state.live[0];
    parts.push(l ? liveCard(l) : idleCard());
    parts.push(pastList());
    view.innerHTML = parts.join('');
    const feed = $('.feed'); if (feed) feed.scrollTop = feed.scrollHeight;
    const strip = $('.strip'); if (strip) strip.scrollLeft = strip.scrollWidth;
  }

  function liveCard(l) {
    const m = meetingOf(l.meetingId);
    const st = state.statuses.get(l.tabId) || l.status || {};
    const lines = [...linesFor(l.meetingId).values()].filter((x) => x.text).sort(byTime);
    const snaps = state.snaps.get(l.meetingId) || [];
    const exporting = state.exporting.includes(l.meetingId);
    const ex = state.exported.get(l.meetingId);
    const ccNow = ccState(st);
    let cc;
    if (ccNow === 'on') cc = `<span class="chip ok" id="cc" data-state="on">Captions on</span>`;
    else if (ccNow === 'off') cc = `<span class="chip warn" id="cc" data-state="off">Captions off <button type="button" data-action="enable-captions" data-tab="${l.tabId}">Turn on</button></span>`;
    else if (ccNow === 'wait') cc = `<span class="chip" id="cc" data-state="wait">Waiting for someone to speak</span>`;
    else cc = `<span class="chip" id="cc" data-state="none">Looking for the captions button…</span>`;
    const src = st.source
      ? `<b>${esc(st.source.label || (st.source.presenting ? 'Presentation' : 'Shared screen'))}</b> ${st.source.width}×${st.source.height}${st.source.presenting ? '' : st.source.likely ? ' (looks like a screen share)' : ''}`
      : st.videos ? `<b>No shared screen found</b> (${plural(st.videos, 'video')} on the page)` : `<b>No video on the page yet</b>`;
    const mode = state.settings.snapshotMode;
    return `<section class="card live" data-meeting="${esc(l.meetingId)}">
      <div class="row"><span class="rec"><i></i> Capturing</span><span class="muted elapsed" data-start="${m.startedAt || Date.now()}">${C.fmtElapsed(Date.now() - (m.startedAt || Date.now()))}</span></div>
      <h1>${esc(m.title || st.title || 'Google Meet')}</h1>
      <div class="chips">${cc}<span class="chip" id="chip-lines">${plural(lines.length, 'line')}</span><span class="chip" id="chip-snaps">${plural(snaps.length, 'snapshot')}</span></div>
      <div class="feed" id="feed">${feedHtml(lines, m)}</div>
      <button type="button" class="primary big" data-action="snapshot" data-tab="${l.tabId}">📷 Snapshot the shared screen</button>
      <p class="fine" style="text-align:center">Also <span class="kbd">Alt</span>+<span class="kbd">Shift</span>+<span class="kbd">S</span> from the Meet tab, or the 📷 button on the page.</p>
      ${st.selfPresenting && !(st.source && (st.source.presenting || st.source.likely)) && !state.display ? `<div class="notice"><b>You're presenting</b>, and Meet shows you no preview of your own share, so it can't be snapshotted from the page. <button type="button" class="link" data-action="my-share" data-meeting="${esc(l.meetingId)}">Capture your own screen share</button> from here instead.</div>` : ''}
      <div class="source" id="source" data-key="${esc(sourceKey(st))}">Source: ${src} <button type="button" class="link" data-action="change-source" data-tab="${l.tabId}">change</button></div>
      ${state.candidates ? pickerHtml(l) : ''}
      ${snaps.length ? `<div class="strip">${snaps.slice(-12).map((s) => `<img class="thumb" src="${s.thumb}" alt="Snapshot at ${C.fmtTime(s.takenAt)}" title="${C.fmtTime(s.takenAt)} · ${esc(s.reason)}">`).join('')}</div>` : ''}
      <div class="field"><span class="lbl">Automatic snapshots</span>
        <div class="seg" role="group" aria-label="Automatic snapshots">
          ${[['change', 'When it changes'], ['timer', `Every ${state.settings.snapshotEverySec}s`], ['both', 'Both'], ['manual', 'Off']].map(([v, t]) => `<button type="button" data-action="mode" data-mode="${v}" aria-pressed="${mode === v}">${t}</button>`).join('')}
        </div></div>
      ${state.display
        ? `<div class="done">Capturing <b>your own screen share</b> from this panel (${plural(state.display.count, 'snapshot')} so far). Keep the panel open. <button type="button" class="link" data-action="stop-share">Stop</button></div>`
        : `<p class="fine">Presenting yourself and Meet shows no preview of it? <button type="button" class="link" data-action="my-share" data-meeting="${esc(l.meetingId)}">Capture your own screen share</button> from here instead.</p>`}
      <div class="actions">
        <button type="button" class="secondary" data-action="export" data-id="${esc(l.meetingId)}" ${exporting ? 'disabled' : ''}>${exporting ? 'Exporting…' : 'Export so far'}</button>
        <button type="button" class="secondary" data-action="copy" data-id="${esc(l.meetingId)}">Copy transcript</button>
      </div>
      ${ex ? `<div class="done"><b>Saved</b> to Downloads/<code>${esc(ex.folder)}</code>${ex.files && ex.files.length > 1 ? ` (${plural(ex.files.length, 'file')})` : ''}.</div>` : ''}
      <p class="fine">${state.settings.autoExport ? 'When you leave the call, everything is exported to Downloads/Meet captures.' : 'Automatic export on leaving is off; use Export when you are done.'}</p>
    </section>`;
  }

  const ccState = (st) => st.regionFound ? 'on' : st.captionsOn === false ? 'off' : st.captionsOn === true ? 'wait' : 'none';
  const sourceKey = (st) => st.source ? `${st.source.id}|${st.source.label}|${st.source.width}` : `videos:${st.videos || 0}`;

  function feedHtml(lines, meeting) {
    if (!lines.length) return `<p class="empty">Captions will appear here as people speak.</p>`;
    const me = state.settings.myName || (meeting && meeting.myName) || '';
    return lines.slice(-8).map((x) => `<p><span class="time">${C.fmtClock(x.startedAt)}</span><b>${esc(C.speakerAlias(x.speaker, me))}:</b> ${esc(x.text.length > 220 ? '…' + x.text.slice(-220) : x.text)}</p>`).join('');
  }

  function pickerHtml(l) {
    const c = state.candidates;
    const items = [`<li role="radio" aria-checked="${c.chosen === 'auto'}" data-action="pick-source" data-id="auto" data-tab="${l.tabId}"><div class="noimg">auto</div><div><b>Pick automatically</b><small>The presentation if Meet marks one, else the widest video</small></div></li>`];
    for (const v of c.list) items.push(`<li role="radio" aria-checked="${c.chosen === v.id}" data-action="pick-source" data-id="${esc(v.id)}" data-tab="${l.tabId}">${v.thumb ? `<img src="${v.thumb}" alt="">` : '<div class="noimg">no preview</div>'}<div><b>${esc(v.label || 'Video')}</b>${v.presenting ? ' <span class="tag">presenting</span>' : ''}${v.self ? ' <span class="tag">you</span>' : ''}<small>${v.width}×${v.height}</small></div></li>`);
    return `<div class="field"><div class="row"><span class="lbl">Which video to snapshot</span><button type="button" class="link" data-action="cancel-source">close</button></div><ul class="pick" role="radiogroup">${items.join('')}</ul>${c.list.length ? '' : '<p class="fine">No playing video on the page right now.</p>'}</div>`;
  }

  function idleCard() {
    return `<section class="card hero">
      <h1>Join a Google Meet call to start capturing.</h1>
      <ol>
        <li><b>Captions get turned on</b> and every line is saved with who said it and when.</li>
        <li><b>The shared screen is snapshotted</b> when it changes, on a timer, or with <span class="kbd">Alt</span>+<span class="kbd">Shift</span>+<span class="kbd">S</span>.</li>
        <li><b>When you leave,</b> the transcript and the images land in Downloads/Meet captures, ready for Claude.</li>
      </ol>
      <button type="button" class="primary" data-action="open-meet">Open Google Meet</button>
      <p class="fine">Everything stays on this computer. No bot joins your call.</p>
    </section>`;
  }

  function pastList() {
    const liveIds = new Set(state.live.map((l) => l.meetingId));
    const past = state.meetings.filter((m) => !liveIds.has(m.id));
    const items = past.map((m) => {
      const exporting = state.exporting.includes(m.id);
      const dur = m.endedAt ? C.fmtDuration(m.endedAt - m.startedAt) : '';
      const status = m.exportedAt ? '<span class="tag">exported</span>' : m.status === 'live' ? '<span class="tag live">interrupted</span>' : '';
      const confirm = state.confirmDelete === m.id;
      return `<li>
        <div class="t">${esc(m.title || m.code || 'Google Meet')}${status}</div>
        <div class="meta">${C.fmtLongDate(m.startedAt)} · ${C.fmtClock(m.startedAt)}${dur ? ' · ' + dur : ''} · ${plural(m.lineCount || 0, 'line')} · ${plural(m.snapshotCount || 0, 'snapshot')}</div>
        ${m.exportFolder ? `<div class="fine">Downloads/${esc(m.exportFolder)}${/\.zip$/i.test((m.exportPaths || [])[0] || '') ? '.zip' : ''}</div>` : ''}
        <div class="acts">
          ${confirm
            ? `<button type="button" class="secondary danger" data-action="delete-yes" data-id="${esc(m.id)}">Yes, delete it</button><button type="button" class="secondary" data-action="delete-no">Keep</button>`
            : `<button type="button" class="secondary" data-action="export" data-id="${esc(m.id)}" ${exporting ? 'disabled' : ''}>${exporting ? 'Exporting…' : m.exportedAt ? 'Export again' : 'Export'}</button>
               <button type="button" class="secondary" data-action="copy" data-id="${esc(m.id)}">Copy</button>
               <button type="button" class="secondary" data-action="claude" data-id="${esc(m.id)}">Open in Claude</button>
               <button type="button" class="secondary danger" data-action="delete" data-id="${esc(m.id)}">Delete</button>`}
        </div>
      </li>`;
    });
    return `<section class="section"><div class="row"><h2>Captured meetings</h2><span class="muted">${past.length || ''}</span></div>
      ${items.length ? `<ul class="list">${items.join('')}</ul>` : '<p class="empty-list">Nothing captured yet. Meetings you leave with captions on appear here, kept for ' + (state.settings.keepDays ? plural(state.settings.keepDays, 'day') : 'ever') + '.</p>'}
    </section>`;
  }

  /** Cheap updates while a call is on: counts, feed, chips, source. Falls back to a full render. */
  function patchLive() {
    const l = state.live[0];
    if (!l || state.showSettings || !$('.live')) return render();
    const st = state.statuses.get(l.tabId) || l.status || {};
    const lines = [...linesFor(l.meetingId).values()].filter((x) => x.text).sort(byTime);
    const feed = $('#feed'); if (feed) { feed.innerHTML = feedHtml(lines, meetingOf(l.meetingId)); feed.scrollTop = feed.scrollHeight; }
    const cl = $('#chip-lines'); if (cl) cl.textContent = plural(lines.length, 'line');
    const cs = $('#chip-snaps'); if (cs) cs.textContent = plural((state.snaps.get(l.meetingId) || []).length, 'snapshot');
    const cc = $('#cc'); if (cc && cc.dataset.state !== ccState(st)) return render();
    if (!!$('.notice') !== !!(st.selfPresenting && !(st.source && (st.source.presenting || st.source.likely)) && !state.display)) return render();
    const h1 = $('.live h1'); const m = meetingOf(l.meetingId); if (h1 && (m.title || st.title) && h1.textContent !== (m.title || st.title)) h1.textContent = m.title || st.title;
    const src = $('#source'); if (src && src.dataset.key !== sourceKey(st)) return render();
  }
  setInterval(() => { const e = $('.elapsed'); if (e) e.textContent = C.fmtElapsed(Date.now() - Number(e.dataset.start)); }, 1000);

  // ------------------------------------------------------------------ settings view
  const T = (key, label, hint) => `<label class="toggle"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" data-setting="${key}" ${state.settings[key] ? 'checked' : ''}></label>`;
  function settingsView() {
    const s = state.settings;
    const sel = (key, opts) => `<select data-setting="${key}">${opts.map(([v, t]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    return `<section class="card settings">
      <div class="row"><h2 style="font-size:16px;text-transform:none;letter-spacing:0;color:var(--text)">Settings</h2><button type="button" class="link" data-action="close-settings">Done</button></div>
      <div class="field"><label for="myName">Your name</label><input id="myName" type="text" data-setting="myName" value="${esc(s.myName)}" placeholder="Shown instead of “You”" autocomplete="off"><small>Meet labels your own lines “You”. Put your name here so the transcript reads naturally.</small></div>
      ${T('autoCaptions', 'Turn captions on when a call starts', 'Clicks Meet’s CC button once. Captions must be on for the transcript to fill.')}
      ${T('autoExport', 'Export when I leave a call', 'The transcript and snapshots are written to Downloads/Meet captures the moment the call ends.')}
      <div class="field"><span class="lbl">Export as</span><div class="radios">
        <label><input type="radio" name="exportFormat" data-setting="exportFormat" value="files" ${s.exportFormat === 'files' ? 'checked' : ''}><span>A folder with transcript.md and the images<small>Drag them all into Claude together.</small></span></label>
        <label><input type="radio" name="exportFormat" data-setting="exportFormat" value="zip" ${s.exportFormat === 'zip' ? 'checked' : ''}><span>One ZIP<small>Handy for Claude Code or for keeping.</small></span></label>
      </div></div>
      ${T('includeJson', 'Include meeting.json', 'The raw lines and snapshot times, for your own tools.')}
      ${T('openClaude', 'After an export, open Claude with the transcript', 'Opens claude.ai in a new tab with the transcript in the message box. Snapshots still need to be attached by hand. Long transcripts open an empty chat instead; the text is on your clipboard when you use Copy.')}
      <div class="field"><label for="preface">Note for Claude at the top of every transcript</label><textarea id="preface" data-setting="preface" placeholder="For example: Summarise the decisions and list every action item with an owner. The snapshots show what I was presenting.">${esc(s.preface)}</textarea></div>
      <h3>Snapshots of the shared screen</h3>
      <div class="field"><span class="lbl">Take them automatically</span><div class="radios">
        ${[['change', 'When the screen changes', 'One snapshot per slide or view, taken once the picture holds still.'], ['timer', 'On a timer', 'Every so many seconds while something is shared.'], ['both', 'Both'], ['manual', 'Never automatically', 'Only the button and the shortcut.']].map(([v, t, h]) => `<label><input type="radio" name="snapshotMode" data-setting="snapshotMode" value="${v}" ${s.snapshotMode === v ? 'checked' : ''}><span>${t}${h ? `<small>${h}</small>` : ''}</span></label>`).join('')}
      </div></div>
      <div class="two">
        <div class="field"><label for="every">Timer, seconds</label><input id="every" type="number" min="10" max="3600" step="5" data-setting="snapshotEverySec" value="${s.snapshotEverySec}"></div>
        <div class="field"><label for="sens">Change sensitivity</label>${sel('snapshotSensitivity', [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']])}</div>
        <div class="field"><label for="fmt">Image format</label>${sel('snapshotFormat', [['png', 'PNG (sharp text)'], ['jpeg', 'JPEG (smaller)']])}</div>
        <div class="field"><label for="maxw">Longest side</label>${sel('snapshotMaxWidth', [[1280, '1280 px'], [1600, '1600 px'], [1920, '1920 px'], [2560, '2560 px']])}</div>
      </div>
      <h3>On the Meet page</h3>
      ${T('showPill', 'Show the status pill', 'A small “Capturing · lines · snapshots” pill with a snapshot button, top left of the call.')}
      <h3>Storage</h3>
      <div class="field"><label for="keep">Keep captured meetings for, days</label><input id="keep" type="number" min="0" max="3650" data-setting="keepDays" value="${s.keepDays}"><small>0 keeps them until you delete them. Exports in Downloads are never touched.</small></div>
      <div class="row"><span class="muted" id="usage">${usageText()}</span><button type="button" class="secondary danger" data-action="delete-all">Delete all captured meetings</button></div>
      <div class="about"><span>Meet Capture for Claude ${esc(VERSION)} · unofficial, not affiliated with Google or Anthropic.</span><span><a href="${REPO}" target="_blank" rel="noopener">Source and issues</a> · <a href="${REPO}/blob/main/PRIVACY.md" target="_blank" rel="noopener">Privacy policy</a> · <a href="chrome://extensions/shortcuts" data-action="shortcuts">Change the shortcut</a></span></div>
    </section>`;
  }
  const usageText = () => state.usage ? `${(state.usage.bytes / 1048576).toFixed(1)} MB in ${plural(state.usage.snapshots, 'snapshot')}` : 'Measuring storage…';
  function afterSettings() { send({ type: 'usage' }); }

  let saveTimer = null;
  function saveSettings() { clearTimeout(saveTimer); saveTimer = setTimeout(() => send({ type: 'settings', settings: state.settings }), 250); }
  function onSetting(e) {
    const el = e.target; const key = el.dataset && el.dataset.setting;
    if (!key) return;
    if (el.type === 'checkbox') state.settings[key] = el.checked;
    else if (el.type === 'radio') { if (el.checked) state.settings[key] = el.value; }
    else if (el.type === 'number') { const n = Number(el.value); if (Number.isFinite(n)) state.settings[key] = Math.max(Number(el.min || 0), Math.min(Number(el.max || 1e9), Math.round(n))); }
    else if (el.tagName === 'SELECT') state.settings[key] = typeof C.DEFAULT_SETTINGS[key] === 'number' ? Number(el.value) : el.value;
    else state.settings[key] = el.value;
    saveSettings();
  }
  view.addEventListener('input', onSetting);
  view.addEventListener('change', onSetting);

  // ------------------------------------------------------------------ actions
  settingsBtn.addEventListener('click', () => { state.showSettings = !state.showSettings; render(); });
  view.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action, id = el.dataset.id, tabId = el.dataset.tab != null ? Number(el.dataset.tab) : undefined;
    switch (a) {
      case 'open-meet': chrome.tabs.create({ url: 'https://meet.google.com/' }); break;
      case 'snapshot': if (state.display) displaySnapshot('manual'); else send({ type: 'snapshot-now', tabId }); break;
      case 'enable-captions': send({ type: 'enable-captions', tabId }); toast('Asked Meet to turn captions on'); break;
      case 'change-source': send({ type: 'candidates', tabId }); break;
      case 'cancel-source': state.candidates = null; render(); break;
      case 'pick-source': send({ type: 'choose-source', tabId, id }); state.candidates = null; toast(id === 'auto' ? 'Picking the source automatically' : 'Snapshots will use that video'); render(); break;
      case 'mode': state.settings.snapshotMode = el.dataset.mode; saveSettings(); if (state.display) state.display.detector.configure(detectorConfig()); render(); break;
      case 'my-share': startDisplay(el.dataset.meeting); break;
      case 'stop-share': stopDisplay(); render(); break;
      case 'export': send({ type: 'export', meetingId: id }); break;
      case 'copy': send({ type: 'markdown', meetingId: id }); break;
      case 'claude': send({ type: 'open-claude', meetingId: id }); send({ type: 'markdown', meetingId: id }); break;
      case 'delete': state.confirmDelete = id; render(); break;
      case 'delete-no': state.confirmDelete = null; render(); break;
      case 'delete-yes': state.confirmDelete = null; send({ type: 'delete', meetingId: id }); state.lines.delete(id); state.snaps.delete(id); break;
      case 'delete-all': if (confirm('Delete every captured meeting from this browser? Files already exported to Downloads stay.')) send({ type: 'delete-all' }); break;
      case 'close-settings': state.showSettings = false; render(); break;
      case 'shortcuts': e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); break;
      default: break;
    }
  });

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Transcript copied. Paste it into Claude.'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand && document.execCommand('copy'); ta.remove();
      toast(ok ? 'Transcript copied. Paste it into Claude.' : 'Could not copy. Export instead.', !ok);
    }
  }

  let toastTimer = null;
  function toast(text, bad) {
    toastEl.textContent = text; toastEl.classList.toggle('bad', !!bad); toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, bad ? 7000 : 3500);
  }

  // ------------------------------------------------------------------ capturing your own screen share from the panel
  const detectorConfig = () => ({ threshold: C.THRESHOLDS[state.settings.snapshotSensitivity] || C.THRESHOLDS.normal, timerMs: state.settings.snapshotMode === 'timer' || state.settings.snapshotMode === 'both' ? Math.max(10, state.settings.snapshotEverySec) * 1000 : 0 });
  async function startDisplay(meetingId) {
    if (state.display) return;
    let stream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false }); }
    catch (e) { if (e && e.name !== 'NotAllowedError') toast('Screen capture did not start: ' + (e.message || e.name), true); return; }
    const video = document.createElement('video'); video.srcObject = stream; video.muted = true;
    try { await video.play(); } catch (e) { /* autoplay rules do not apply to muted streams */ }
    const canvas = document.createElement('canvas');
    const detector = C.createChangeDetector(detectorConfig());
    const d = state.display = { stream, video, canvas, detector, meetingId, count: 0, timer: null };
    d.timer = setInterval(() => {
      if (!state.display || video.readyState < 2) return;
      let sig; try { sig = C.signatureOf(video, canvas); } catch (e) { return; }
      const reason = detector.sample(sig, 'display');
      if (!reason) return;
      const mode = state.settings.snapshotMode;
      if (mode === 'manual') return;
      if (reason === 'timer' && mode === 'change') return;
      if ((reason === 'screen changed' || reason === 'new source') && mode === 'timer') return;
      displaySnapshot(reason, sig);
    }, 2000);
    stream.getVideoTracks()[0].addEventListener('ended', () => { stopDisplay(); render(); });
    toast('Capturing your screen share from this panel');
    render();
  }
  function displaySnapshot(reason, sig) {
    const d = state.display; if (!d || d.video.readyState < 2) return;
    let shot;
    try { shot = C.capture(d.video, { maxWidth: state.settings.snapshotMaxWidth, format: state.settings.snapshotFormat, quality: 0.9, doc: document }); } catch (e) { toast('That snapshot did not work', true); return; }
    try { d.detector.saved(sig || C.signatureOf(d.video, d.canvas)); } catch (e) { /* fine */ }
    d.count++;
    send({ type: 'display-snapshot', meetingId: d.meetingId, snapshot: { takenAt: Date.now(), reason, source: 'Your screen share', width: shot.width, height: shot.height, format: shot.format, dataUrl: shot.dataUrl, thumb: shot.thumb } });
    render();
  }
  function stopDisplay() {
    const d = state.display; if (!d) return;
    clearInterval(d.timer);
    for (const t of d.stream.getTracks()) t.stop();
    state.display = null;
  }

  connect();
})();
