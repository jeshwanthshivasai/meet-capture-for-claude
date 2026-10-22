// The captures page. Meetings on the left, the chosen one on the right: its transcript with the
// snapshots in place, and what to do with it (open in Claude, copy, one ZIP, save to a folder).
// Data is read straight from IndexedDB; live changes and commands go through a port to the worker.
(() => {
  const C = window.MCC, S = C.store;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = C.esc;
  const VERSION = chrome.runtime.getManifest().version;
  const REPO = 'https://github.com/jeshwanthshivasai/meet-capture-for-claude';
  const shell = $('#shell'), listEl = $('#list'), main = $('#main'), toastEl = $('#toast'), searchEl = $('#search');
  const ICONS = {
    claude: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2 9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>',
    zip: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 3 7.17 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.17L15 3H9zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>',
  };

  const state = {
    meetings: [], live: [], settings: C.settingsWithDefaults(null), exporting: [], error: '', gotState: false,
    current: null, lines: new Map(), snaps: new Map(), loading: new Map(), status: new Map(),
    search: '', follow: true, folder: null, menuOpen: false, lightbox: null, autoSaved: new Set(),
  };

  // ------------------------------------------------------------------ port
  let port = null;
  function connect() {
    try { port = chrome.runtime.connect({ name: 'app' }); } catch (e) { return; }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; port = null; setTimeout(connect, 800); });
  }
  const send = (m) => { if (port) { try { port.postMessage(m); } catch (e) { /* reconnecting */ } } };

  function onMessage(m) {
    if (!m || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'state': {
        state.live = m.live || []; state.meetings = m.meetings || []; state.settings = C.settingsWithDefaults(m.settings);
        state.exporting = m.exporting || []; state.error = m.error || ''; state.gotState = true;
        for (const l of state.live) if (l.status && l.status.inCall) state.status.set(l.meetingId, l.status);
        for (const [id] of state.status) if (!state.live.some((l) => l.meetingId === id)) state.status.delete(id);
        renderList();
        if (state.current && !state.meetings.some((x) => x.id === state.current)) { if (state.gotState) renderMain(); break; }
        if (state.current) { if ($('#head')) { renderHead(); scheduleTimeline(); } else { renderMain(); renderTimeline(); } } else renderMain();
        if ($('#settings').open) fillSettings();
        maybeAutoSave();
        break;
      }
      case 'lines': {
        const arr = state.lines.get(m.meetingId);
        if (!arr) break;
        const byId = new Map(arr.map((l) => [String(l.id), l]));
        for (const l of m.lines) byId.set(String(l.id), { ...byId.get(String(l.id)), ...l, id: String(l.id) });
        state.lines.set(m.meetingId, [...byId.values()]);
        if (m.meetingId === state.current) scheduleTimeline();
        break;
      }
      case 'snapshot': {
        const arr = state.snaps.get(m.meetingId);
        if (!arr) break;
        if (!arr.some((s) => s.key === m.snapshot.key)) arr.push(m.snapshot);
        if (m.meetingId === state.current) scheduleTimeline();
        break;
      }
      case 'status': if (m.status && m.status.inCall) { state.status.set(m.status.meetingId, m.status); if (m.status.meetingId === state.current) renderHead(); } break;
      case 'exporting': renderHead(); break;
      case 'exported': { state.exporting = state.exporting.filter((x) => x !== m.meetingId); renderHead(); toast(`ZIP saved: ${m.path ? m.path.split(/[\\/]/).slice(-2).join('/') : m.file}`, m.downloadId != null ? { label: 'Show', run: () => chrome.downloads.show(m.downloadId) } : null); break; }
      case 'export-failed': state.exporting = state.exporting.filter((x) => x !== m.meetingId); renderHead(); toast('The ZIP could not be saved: ' + m.error); break;
      case 'toast': toast(m.text); break;
      case 'settings': state.settings = C.settingsWithDefaults(m.settings); if ($('#settings').open) fillSettings(); if (state.current) renderHead(); break;
      case 'show': if (m.meetingId) go(m.meetingId); break;
      case 'claude-opened': if (!m.fits) { copyTranscript(m.meetingId, true).then(() => toast('The transcript is too long to prefill. It is on your clipboard: paste it into the chat.')); } break;
      case 'usage': { const u = $('#usage'); if (u) u.textContent = `${(m.usage.bytes / 1048576).toFixed(1)} MB in ${m.usage.snapshots} snapshots`; break; }
      default: break;
    }
  }

  // ------------------------------------------------------------------ routing
  const idFromHash = () => { const m = /[#&]m=([^&]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; };
  function go(id) { const h = id ? '#m=' + encodeURIComponent(id) : ''; if (location.hash !== h) location.hash = h; else route(); }
  function route() {
    const id = idFromHash();
    state.current = id;
    state.menuOpen = false;
    shell.classList.toggle('has-current', !!id);
    renderList();
    renderMain();
    if (id) { loadMeeting(id).then(() => { if (state.current === id) { renderTimeline(); maybeAutoSave(); } }); main.scrollTop = 0; main.focus({ preventScroll: true }); }
  }
  window.addEventListener('hashchange', route);

  async function loadMeeting(id) {
    if (state.lines.has(id)) return;
    if (state.loading.has(id)) return state.loading.get(id);
    const p = (async () => {
      const [lines, snaps] = await Promise.all([S.getLines(id), S.getSnapshots(id)]);
      state.lines.set(id, lines); state.snaps.set(id, snaps);
    })().catch((e) => { toast('Could not read this meeting: ' + e.message); }).finally(() => state.loading.delete(id));
    state.loading.set(id, p);
    return p;
  }

  const meetingById = (id) => state.meetings.find((m) => m.id === id);
  const isLive = (m) => m && (m.status === 'live' || state.live.some((l) => l.meetingId === m.id));
  const titleOf = (m) => C.titleOf(m);

  // ------------------------------------------------------------------ the list
  function dayLabel(ts) {
    const d = new Date(ts), now = new Date();
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, now)) return 'Today';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  function renderList() {
    const q = state.search.trim().toLowerCase();
    const items = state.meetings.filter((m) => !q || `${titleOf(m)} ${m.code || ''} ${(m.participants || []).join(' ')}`.toLowerCase().includes(q));
    if (!items.length) { listEl.innerHTML = `<div class="none">${state.meetings.length ? 'No meeting matches.' : 'No meetings yet.'}</div>`; return; }
    let html = '', day = '';
    for (const m of items) {
      const d = dayLabel(m.startedAt);
      if (d !== day) { day = d; html += `<div class="day">${esc(d)}</div>`; }
      const live = isLive(m);
      const sub = [C.fmtClock(m.startedAt), live ? 'live' : C.fmtDuration((m.endedAt || Date.now()) - m.startedAt), `${m.lineCount || 0} lines`, `${m.snapshotCount || 0} snapshots`].join(' · ');
      html += `<button class="item${m.id === state.current ? ' active' : ''}" data-id="${esc(m.id)}" aria-current="${m.id === state.current ? 'page' : 'false'}"><div class="t">${live ? '<span class="live-dot" aria-label="live"></span>' : ''}<span>${esc(titleOf(m))}</span></div><div class="s">${esc(sub)}</div></button>`;
    }
    listEl.innerHTML = html;
  }
  listEl.addEventListener('click', (e) => { const b = e.target.closest('.item'); if (b) go(b.dataset.id); });
  searchEl.addEventListener('input', () => { state.search = searchEl.value; renderList(); });
  $('#rail-foot').innerHTML = `<span>Meet Capture ${esc(VERSION)}</span><a href="${REPO}" target="_blank" rel="noopener">GitHub</a><a href="${REPO}/blob/main/PRIVACY.md" target="_blank" rel="noopener">Privacy</a>`;

  // ------------------------------------------------------------------ the main column
  function renderMain() {
    if (!state.current) {
      if (state.error) { main.innerHTML = `<div class="hero"><h1>Storage problem</h1><p>${esc(state.error)}</p></div>`; return; }
      main.innerHTML = `<div class="hero"><img src="../icons/icon128.png" alt=""><h1>${state.meetings.length ? 'Pick a meeting' : 'Your meetings will appear here'}</h1>
        <p>${state.meetings.length ? 'Choose one on the left to read its transcript, see the snapshots and hand it to Claude.' : 'Join a Google Meet call and Meet Capture takes it from there: captions become a transcript with names and times, the shared screen is snapshotted as it changes, and this page opens when you leave.'}</p>
        ${state.meetings.length ? '' : `<ul class="steps">
          <li><span class="n">1</span><div><b>Join a call</b><span>The capture button joins Meet's bottom bar, next to Chat. Captions switch on by themselves.</span></div></li>
          <li><span class="n">2</span><div><b>Talk, share, present</b><span>Lines and snapshots land in the panel inside Meet as they happen. Alt+Shift+S takes a snapshot now.</span></div></li>
          <li><span class="n">3</span><div><b>Leave</b><span>This page opens on the meeting: open it in Claude, copy it, save one ZIP or write everything into a folder.</span></div></li></ul>`}</div>`;
      return;
    }
    const m = meetingById(state.current);
    if (!m) { main.innerHTML = state.gotState ? `<div class="hero"><h1>That meeting is gone</h1><p>It was deleted or cleaned up.</p><p><button class="btn tonal" data-act="home">All meetings</button></p></div>` : ''; return; }
    main.innerHTML = `<div class="page">
      <div class="crumbs"><button class="btn sm" data-act="home">${ICONS.back} All meetings</button></div>
      <div id="head"></div>
      <div id="callout"></div>
      <div id="strip-wrap"></div>
      <div class="section-h" id="tl-h">Transcript</div>
      <div class="tl" id="tl"></div>
      <div class="follow" id="follow" hidden><button class="btn tonal sm" data-act="follow">New lines ↓</button></div>
    </div>`;
    renderHead();
    renderTimeline();
  }

  function renderHead() {
    const head = $('#head'); const m = meetingById(state.current);
    if (!head || !m) return;
    if (head.querySelector('.title-edit')) return; // a rename is being typed: leave the header alone until it ends
    const live = isLive(m), st = state.status.get(m.id);
    const end = live ? Date.now() : (m.endedAt || m.startedAt);
    const people = (m.participants || []).map((p) => C.speakerAlias(p, C.selfName(m, state.settings)));
    const uniq = [...new Set(people)];
    const exporting = state.exporting.includes(m.id);
    const folderLabel = state.folder ? `Save to ${state.folder.name}` : 'Save to folder';
    head.innerHTML = `<div class="head"><div class="grow">
        <h1 class="title" id="title" title="Double-click to rename">${esc(titleOf(m))}</h1>
        <div class="meta">${live ? `<span class="live"><span class="live-dot"></span>Live · <span id="elapsed">${C.fmtElapsed(end - m.startedAt)}</span></span>` : ''}<span>${esc(C.fmtLongDate(m.startedAt))}</span><span>${esc(C.fmtClock(m.startedAt))}–${esc(C.fmtClock(end))} (${esc(C.fmtDuration(end - m.startedAt))})</span>${m.code ? `<span>${esc(m.code)}</span>` : ''}<span>${m.lineCount || 0} lines · ${m.snapshotCount || 0} snapshots</span>${live && st ? `<span>${st.regionFound ? 'captions flowing' : st.captionsOn === false ? 'captions off' : 'waiting for captions'}</span>` : ''}</div>
        ${uniq.length ? `<div class="people">${uniq.map((p) => `<span class="chip"><span class="av" style="background:${C.colorFor(p)}">${esc(C.initials(p))}</span>${esc(p)}</span>`).join('')}</div>` : ''}
      </div></div>
      <div class="actions">
        ${live ? `<button class="btn primary" data-act="snapshot">${ICONS.camera}Snapshot now</button><button class="btn tonal" data-act="focus">Go to the call</button>` : `<button class="btn primary" data-act="claude" title="Opens a new claude.ai chat with the transcript in the message box. Add the snapshots from the ZIP or the folder.">${ICONS.claude}Open in Claude</button>`}
        <button class="btn tonal" data-act="copy">${ICONS.copy}Copy transcript</button>
        <button class="btn outline" data-act="zip" ${exporting ? 'disabled' : ''}>${ICONS.zip}${exporting ? 'Preparing ZIP…' : m.zipAt ? 'Download ZIP again' : 'Download ZIP'}</button>
        <button class="btn outline" data-act="folder" ${'showDirectoryPicker' in window ? '' : 'hidden'}>${ICONS.folder}${esc(folderLabel)}</button>
        <span class="spacer"></span>
        <div class="menu"><button class="ib" data-act="menu" aria-label="More" aria-haspopup="menu" aria-expanded="${state.menuOpen}">${ICONS.more}</button>${state.menuOpen ? `<ul class="menu-list" role="menu">
          <li><button role="menuitem" data-act="rename">Rename</button></li>
          ${m.url ? `<li><button role="menuitem" data-act="meet-link">Open the Meet link</button></li>` : ''}
          ${live ? `<li><button role="menuitem" data-act="open-panel">Open the panel in Meet</button></li><li><button role="menuitem" data-act="end">Stop capturing</button></li>` : ''}
          <li><hr></li><li><button role="menuitem" class="danger" data-act="delete">Delete meeting</button></li></ul>` : ''}</div>
      </div>
      ${m.savedAt ? `<p class="note">Saved to ${esc(m.savedPath || m.savedFolder)} · ${esc(C.fmtClock(m.savedAt))}${m.zipAt ? ` · ZIP ${esc(C.fmtClock(m.zipAt))}` : ''}</p>` : m.zipAt ? `<p class="note">ZIP saved ${esc(C.fmtClock(m.zipAt))} · ${esc(m.zipPath || m.zipFile)}</p>` : ''}`;
    renderCallout(m);
  }
  function renderCallout(m) {
    const c = $('#callout'); if (!c) return;
    const live = isLive(m);
    if (live) { c.innerHTML = ''; return; }
    const lines = state.lines.get(m.id);
    if (lines && !lines.length && !(m.snapshotCount || 0)) { c.innerHTML = `<div class="callout"><div class="grow"><b>Nothing was captured in this call.</b><br>Captions must be on in Meet for a transcript; snapshots need a shared screen. The capture panel in Meet shows both as they happen.</div></div>`; return; }
    if (state.settings.autoFolder && state.folder && !m.savedAt && state.autoSaved.has(m.id + ':denied')) {
      c.innerHTML = `<div class="callout"><div class="grow">Chrome needs a click before this page may write into <b>${esc(state.folder.name)}</b>.</div><button class="btn primary sm" data-act="folder">Save now</button></div>`; return;
    }
    c.innerHTML = '';
  }
  let elapsedTimer = setInterval(() => { const el = $('#elapsed'); const m = meetingById(state.current); if (el && m) el.textContent = C.fmtElapsed(Date.now() - m.startedAt); }, 1000);
  void elapsedTimer;

  // ------------------------------------------------------------------ the timeline
  let tlTimer = null;
  function scheduleTimeline() { if (tlTimer) return; tlTimer = setTimeout(() => { tlTimer = null; renderTimeline(); renderHead(); }, 250); }
  const lazy = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const img = en.target; lazy.unobserve(img);
      fullImage(img.dataset.key).then((url) => { if (url) img.src = url; }).catch(() => {});
    }
  }, { rootMargin: '400px' });
  const urls = new Map(); // snapshot key → object URL of the full image
  async function fullImage(key) {
    if (urls.has(key)) return urls.get(key);
    const rec = await S.getSnapshot(key);
    if (!rec || !rec.bytes) return '';
    const url = URL.createObjectURL(new Blob([rec.bytes], { type: rec.format === 'jpeg' ? 'image/jpeg' : 'image/png' }));
    urls.set(key, url);
    return url;
  }
  function renderTimeline() {
    const tl = $('#tl'), m = meetingById(state.current);
    if (!tl || !m) return;
    const lines = state.lines.get(m.id), snaps = state.snaps.get(m.id) || [];
    const wrap = $('#strip-wrap');
    if (!lines) { tl.innerHTML = ''; wrap.innerHTML = ''; return; }
    const tidy = C.tidyLines(C.withNames(lines, m, state.settings));
    const files = snaps.map((s, i) => ({ ...s, n: i + 1 }));
    wrap.innerHTML = files.length ? `<div class="section-h">Snapshots <span>· ${files.length}</span></div><div class="strip">${files.map((f) => `<button class="thumb" data-act="view" data-n="${f.n}" aria-label="Snapshot ${f.n}"><img src="${esc(f.thumb || '')}" alt="" loading="lazy"><div class="cap"><b>${f.n}</b><span>${esc(C.fmtTime(f.takenAt))} · ${esc(f.reason)}</span></div></button>`).join('')}</div>` : '';
    let html = '', si = 0, prev = '';
    const card = (f) => `<div class="snapcard" data-n="${f.n}"><img data-key="${esc(f.key)}" src="${esc(f.thumb || '')}" alt="Snapshot ${f.n}" data-act="view" data-n="${f.n}"><div class="cap"><b>Snapshot ${f.n}</b><span>${esc(C.fmtTime(f.takenAt))} · ${esc(f.reason)}${f.source ? ' · ' + esc(f.source) : ''}</span><span class="spacer"></span><button class="btn sm" data-act="copy-image" data-n="${f.n}">Copy image</button></div></div>`;
    const entry = (l, cont) => `<div class="entry${cont ? ' cont' : ''}"><div class="av" style="background:${C.colorFor(l.speaker)}">${esc(C.initials(l.speaker))}</div><div><div class="who"${cont ? ' hidden' : ''}><span class="name">${esc(l.speaker)}</span><span class="time">${esc(C.fmtTime(l.startedAt))}</span></div><div class="text">${esc(l.text)}</div></div></div>`;
    for (const l of tidy) {
      while (si < files.length && files[si].takenAt <= l.startedAt) { html += `<div class="entry"><div></div>${card(files[si++])}</div>`; prev = ''; }
      html += entry(l, prev === l.speaker); prev = l.speaker;
    }
    while (si < files.length) html += `<div class="entry"><div></div>${card(files[si++])}</div>`;
    if (!tidy.length) html += `<div class="empty-tl">${isLive(m) ? 'Lines appear here as people speak.' : 'No captions were captured. Captions must be on in Meet (the CC button) for the transcript to fill.'}</div>`;
    tl.innerHTML = html;
    for (const img of tl.querySelectorAll('img[data-key]')) lazy.observe(img);
    if (isLive(m) && state.follow) main.scrollTop = main.scrollHeight;
    requestAnimationFrame(updateFollow);
  }
  /** While a call is live the page keeps up with new lines unless you scrolled up; then a chip offers the way back. */
  function updateFollow() {
    const f = $('#follow'), m = meetingById(state.current);
    if (!f) return;
    const near = main.scrollHeight - main.scrollTop - main.clientHeight < 120;
    f.hidden = !(m && isLive(m) && !near);
  }
  main.addEventListener('scroll', () => { state.follow = main.scrollHeight - main.scrollTop - main.clientHeight < 120; updateFollow(); });

  // ------------------------------------------------------------------ actions
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const m = meetingById(state.current);
    const act = b.dataset.act;
    try {
      if (act === 'home') return go('');
      if (!m) return;
      if (act === 'claude') { send({ type: 'open-claude', meetingId: m.id }); toast('Opening Claude with the transcript…'); }
      else if (act === 'copy') { await copyTranscript(m.id); toast('Transcript copied.'); }
      else if (act === 'zip') { state.exporting.push(m.id); renderHead(); send({ type: 'export', meetingId: m.id }); }
      else if (act === 'folder') await saveToFolder(m.id, { silent: false });
      else if (act === 'snapshot') send({ type: 'snapshot-now', tabId: m.tabId });
      else if (act === 'focus') send({ type: 'focus-meet', meetingId: m.id });
      else if (act === 'open-panel') { send({ type: 'open-panel', tabId: m.tabId }); send({ type: 'focus-meet', meetingId: m.id }); closeMenu(); }
      else if (act === 'end') { closeMenu(); if (await confirm('Stop capturing this call?', 'What was captured so far is kept. The call itself continues.', 'Stop capturing')) send({ type: 'end-meeting', meetingId: m.id }); }
      else if (act === 'menu') { state.menuOpen = !state.menuOpen; renderHead(); if (state.menuOpen) $('.menu-list button') && $('.menu-list button').focus(); }
      else if (act === 'rename') { closeMenu(); startRename(m); }
      else if (act === 'meet-link') { closeMenu(); chrome.tabs.create({ url: m.url }); }
      else if (act === 'delete') { closeMenu(); if (await confirm('Delete this meeting?', `"${titleOf(m)}" with its ${m.lineCount || 0} lines and ${m.snapshotCount || 0} snapshots will be removed from this computer. Files you saved or downloaded stay.`, 'Delete')) { send({ type: 'delete', meetingId: m.id }); go(''); } }
      else if (act === 'view') openLightbox(m.id, Number(b.dataset.n));
      else if (act === 'copy-image') { await copyImage(m.id, Number(b.dataset.n)); toast('Image copied. Paste it into the chat.'); }
      else if (act === 'follow') { state.follow = true; main.scrollTop = main.scrollHeight; updateFollow(); }
    } catch (err) { toast(String((err && err.message) || err)); }
  });
  function closeMenu() { if (state.menuOpen) { state.menuOpen = false; renderHead(); } }
  document.addEventListener('click', (e) => { if (state.menuOpen && !e.target.closest('.menu')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.menuOpen) closeMenu(); });
  main.addEventListener('dblclick', (e) => { if (e.target.closest('#title')) { const m = meetingById(state.current); if (m) startRename(m); } });

  function startRename(m) {
    const h = $('#title'); if (!h) return;
    const input = document.createElement('input');
    input.className = 'title-edit'; input.value = titleOf(m); input.maxLength = 120; input.setAttribute('aria-label', 'Meeting title');
    h.replaceWith(input); input.focus(); input.select();
    let done = false;
    const finish = (save) => {
      if (done) return; done = true;
      const title = C.normalize(input.value);
      input.remove();
      if (save && title && title !== titleOf(m)) { m.title = title; m.renamed = true; send({ type: 'rename', meetingId: m.id, title }); renderList(); }
      renderHead();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }

  async function dataFor(id) {
    await loadMeeting(id);
    const m = meetingById(id);
    if (!m) throw new Error('That meeting is no longer stored.');
    return { meeting: m, lines: state.lines.get(id) || [], snapshots: state.snaps.get(id) || [], settings: state.settings };
  }
  async function copyTranscript(id, quiet) {
    const d = await dataFor(id);
    const text = C.buildMarkdown(d);
    try { await navigator.clipboard.writeText(text); } catch (e) { if (!quiet) throw new Error('Chrome refused the clipboard. Click the page and try again.'); }
    return text;
  }
  async function copyImage(id, n) {
    const snaps = state.snaps.get(id) || [];
    const s = snaps[n - 1]; if (!s) return;
    const rec = await S.getSnapshot(s.key);
    if (!rec || !rec.bytes) throw new Error('That snapshot is not stored any more.');
    let blob = new Blob([rec.bytes], { type: rec.format === 'jpeg' ? 'image/jpeg' : 'image/png' });
    if (rec.format === 'jpeg') blob = await toPng(blob); // the clipboard takes PNG only
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }
  async function toPng(blob) {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return new Promise((r) => c.toBlob(r, 'image/png'));
  }

  // ------------------------------------------------------------------ save to a folder (File System Access)
  async function loadFolder() {
    try { const h = await S.getKV('folder'); state.folder = h && typeof h.queryPermission === 'function' ? h : null; } catch (e) { state.folder = null; }
    if (state.current) renderHead();
  }
  async function chooseFolder() {
    const handle = await window.showDirectoryPicker({ id: 'meet-captures', mode: 'readwrite', startIn: 'documents' });
    try { await S.setKV('folder', handle); } catch (e) { /* not storable: it is used for this visit only */ }
    state.folder = handle;
    return handle;
  }
  async function forgetFolder() { await S.deleteKV('folder'); state.folder = null; if (state.settings.autoFolder) saveSettings({ autoFolder: false }); renderHead(); }
  /** Writes transcript.md and the snapshots into <folder>/<date time title>/. One picker the first time, then one click. */
  async function saveToFolder(id, { silent } = {}) {
    let handle = state.folder;
    if (!handle) { if (silent) return false; handle = await chooseFolder(); }
    let perm = 'prompt';
    try { perm = await handle.queryPermission({ mode: 'readwrite' }); } catch (e) { perm = 'prompt'; }
    if (perm !== 'granted') {
      if (silent) return false;
      try { perm = await handle.requestPermission({ mode: 'readwrite' }); } catch (e) { perm = 'denied'; }
      if (perm !== 'granted') throw new Error(`Chrome did not allow writing to ${handle.name}.`);
    }
    const d = await dataFor(id);
    const withBytes = await S.getSnapshots(id, { withData: true });
    const files = C.exportFiles({ ...d, snapshots: withBytes });
    const sub = C.folderName(d.meeting).split('/').pop();
    const dir = await handle.getDirectoryHandle(sub, { create: true });
    for (const f of files) {
      const fh = await dir.getFileHandle(f.name, { create: true });
      const w = await fh.createWritable();
      await w.write(f.data); await w.close();
    }
    send({ type: 'saved', meetingId: id, folder: handle.name, path: `${handle.name}/${sub}` });
    state.autoSaved.add(id);
    toast(`Saved ${files.length} files to ${handle.name}/${sub}`);
    return true;
  }
  /** After a call, write into the chosen folder without a click when Chrome still allows it. */
  async function maybeAutoSave() {
    const m = meetingById(state.current);
    if (!m || isLive(m) || m.savedAt || !state.settings.autoFolder || !state.folder || state.autoSaved.has(m.id) || state.autoSaved.has(m.id + ':denied')) return;
    if ((m.lineCount || 0) + (m.snapshotCount || 0) === 0) return;
    if (Date.now() - (m.endedAt || 0) > 10 * 60000) return; // only a call that just ended
    state.autoSaved.add(m.id);
    try { const ok = await saveToFolder(m.id, { silent: true }); if (!ok) { state.autoSaved.delete(m.id); state.autoSaved.add(m.id + ':denied'); renderCallout(m); } }
    catch (e) { state.autoSaved.add(m.id + ':denied'); renderCallout(m); }
  }

  // ------------------------------------------------------------------ lightbox
  const lb = $('#lightbox');
  async function openLightbox(id, n) {
    const snaps = state.snaps.get(id) || [];
    if (!snaps[n - 1]) return;
    state.lightbox = { id, n };
    const s = snaps[n - 1];
    lb.innerHTML = `<div class="lb">
      <img src="${esc(s.thumb || '')}" alt="Snapshot ${n}">
      <div class="bar"><span class="cap">Snapshot ${n} of ${snaps.length} · ${esc(C.fmtTime(s.takenAt))} · ${esc(s.reason)}${s.source ? ' · ' + esc(s.source) : ''} · ${s.width}×${s.height}</span>
        <button class="btn sm" data-lb="copy">${ICONS.copy}Copy image</button><button class="btn sm" data-lb="download">${ICONS.zip}Download</button></div>
      <button class="nav prev" data-lb="prev" aria-label="Previous" ${n > 1 ? '' : 'hidden'}>${ICONS.back}</button>
      <button class="nav next" data-lb="next" aria-label="Next" ${n < snaps.length ? '' : 'hidden'} style="transform:translateY(-50%) scaleX(-1)">${ICONS.back}</button>
      <button class="ib close" data-lb="close" aria-label="Close" style="color:#fff">${ICONS.close}</button></div>`;
    if (!lb.open) lb.showModal();
    const url = await fullImage(s.key);
    if (url && state.lightbox && state.lightbox.n === n) lb.querySelector('img').src = url;
  }
  lb.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lb]');
    if (!b) { if (e.target === lb) lb.close(); return; }
    const { id, n } = state.lightbox || {};
    const act = b.dataset.lb;
    try {
      if (act === 'close') lb.close();
      else if (act === 'prev') openLightbox(id, n - 1);
      else if (act === 'next') openLightbox(id, n + 1);
      else if (act === 'copy') { await copyImage(id, n); toast('Image copied. Paste it into the chat.'); }
      else if (act === 'download') {
        const s = (state.snaps.get(id) || [])[n - 1]; const url = await fullImage(s.key); const m = meetingById(id);
        await chrome.downloads.download({ url, filename: `${C.folderName(m)}/${C.snapshotFile(n, s.format)}`, conflictAction: 'uniquify', saveAs: false });
        toast('Saved to Downloads/Meet captures.');
      }
    } catch (err) { toast(String((err && err.message) || err)); }
  });
  lb.addEventListener('keydown', (e) => { const { id, n } = state.lightbox || {}; if (!id) return; if (e.key === 'ArrowLeft' && n > 1) openLightbox(id, n - 1); else if (e.key === 'ArrowRight') openLightbox(id, n + 1); });
  lb.addEventListener('close', () => { state.lightbox = null; });

  // ------------------------------------------------------------------ confirm
  const cf = $('#confirm');
  function confirm(title, text, okLabel) {
    cf.innerHTML = `<div class="dlg"><h2 id="confirm-title">${esc(title)}</h2><p class="sub">${esc(text)}</p><div class="buttons"><button class="btn" data-c="0">Cancel</button><button class="btn primary" data-c="1">${esc(okLabel)}</button></div></div>`;
    cf.showModal();
    return new Promise((resolve) => {
      const on = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; cf.removeEventListener('click', on); cf.close(); resolve(b.dataset.c === '1'); };
      cf.addEventListener('click', on);
      cf.addEventListener('close', () => { cf.removeEventListener('click', on); resolve(false); }, { once: true });
    });
  }

  // ------------------------------------------------------------------ settings
  const sd = $('#settings');
  function openSettings() {
    sd.innerHTML = `<form class="dlg" method="dialog" id="settings-form">
      <h2 id="settings-title">Settings</h2><p class="sub">Everything stays on this computer.</p>
      <div class="field"><label for="s-myName">Your name</label><input type="text" id="s-myName" name="myName" placeholder="As it should appear in transcripts"><span class="help">Meet labels you "You". This name replaces it, in every meeting, including past ones.</span></div>
      <div class="field"><span class="lbl">When you leave a call</span><div class="radios">
        <label><input type="radio" name="afterCall" value="open"><span>Open the meeting here<small>This page opens on the meeting, ready for Claude.</small></span></label>
        <label><input type="radio" name="afterCall" value="zip"><span>Save one ZIP to Downloads<small>Downloads/Meet captures/&lt;date time title&gt;.zip</small></span></label>
        <label><input type="radio" name="afterCall" value="both"><span>Both</span></label>
        <label><input type="radio" name="afterCall" value="nothing"><span>Nothing<small>Open this page from the toolbar icon when you want it.</small></span></label></div></div>
      <div class="field"><label class="check"><input type="checkbox" name="openClaude"><span>Also open Claude with the transcript<small>A new claude.ai chat with the transcript in the message box (up to 60,000 characters).</small></span></label></div>
      <div class="field"><span class="lbl">Folder</span><div class="folder-row" id="folder-row"></div>
        <label class="check"><input type="checkbox" name="autoFolder" id="s-autoFolder"><span>Write every meeting there when it ends<small>Transcript and snapshots, in a folder named after the meeting. Chrome may ask for one click the first time this page opens after a call.</small></span></label></div>
      <div class="field"><label for="s-preface">Note for Claude</label><textarea id="s-preface" name="preface" placeholder="e.g. Summarise the decisions and list action items with owners."></textarea><span class="help">Placed at the top of every transcript under "For Claude".</span></div>
      <div class="section"><h3>Snapshots</h3>
        <div class="cols">
          <div class="field"><label for="s-snapshotMode">Automatic snapshots</label><select id="s-snapshotMode" name="snapshotMode"><option value="change">When the screen changes</option><option value="both">On change and on a timer</option><option value="timer">On a timer only</option><option value="manual">Only by hand</option></select></div>
          <div class="field"><label for="s-snapshotEverySec">Timer, seconds</label><input type="number" id="s-snapshotEverySec" name="snapshotEverySec" min="10" max="3600"></div>
          <div class="field"><label for="s-snapshotSensitivity">Sensitivity</label><select id="s-snapshotSensitivity" name="snapshotSensitivity"><option value="low">Low: big changes only</option><option value="normal">Normal</option><option value="high">High: small changes too</option></select></div>
          <div class="field"><label for="s-snapshotFormat">Image format</label><select id="s-snapshotFormat" name="snapshotFormat"><option value="png">PNG (sharp text)</option><option value="jpeg">JPEG (smaller)</option></select></div>
          <div class="field"><label for="s-snapshotMaxWidth">Longest side, pixels</label><input type="number" id="s-snapshotMaxWidth" name="snapshotMaxWidth" min="640" max="3840" step="10"></div>
        </div><span class="help">Alt+Shift+S takes one now, in any mode. Change the shortcut at chrome://extensions/shortcuts.</span></div>
      <div class="section"><h3>In Meet</h3>
        <div class="field"><label class="check"><input type="checkbox" name="autoCaptions"><span>Turn captions on when a call starts<small>There is no transcript without them.</small></span></label></div>
        <div class="field"><label class="check"><input type="checkbox" name="openPanel"><span>Open the capture panel when a call starts</span></label></div></div>
      <div class="section"><h3>Storage</h3>
        <div class="cols"><div class="field"><label for="s-keepDays">Keep meetings for, days</label><input type="number" id="s-keepDays" name="keepDays" min="0" max="3650"><span class="help">0 keeps them until you delete them.</span></div>
        <div class="field"><span class="lbl">Usage</span><span id="usage">…</span><span class="help"><button type="button" class="btn sm danger" id="delete-all">Delete all meetings</button></span></div></div>
        <div class="field"><label class="check"><input type="checkbox" name="includeJson"><span>Add meeting.json to exports<small>The raw lines and snapshot list, for your own tools.</small></span></label></div></div>
      <div class="foot"><span>Meet Capture for Claude ${esc(VERSION)}</span><a href="${REPO}" target="_blank" rel="noopener">GitHub</a><a href="${REPO}/blob/main/PRIVACY.md" target="_blank" rel="noopener">Privacy</a><a href="${REPO}/issues" target="_blank" rel="noopener">Report a problem</a></div>
      <div class="buttons"><button class="btn primary" value="close">Done</button></div></form>`;
    fillSettings();
    sd.showModal();
    send({ type: 'usage' });
    const form = $('#settings-form');
    let t = null;
    form.addEventListener('input', (e) => { if (e.target.matches('input[type="text"], textarea, input[type="number"]')) { clearTimeout(t); t = setTimeout(() => saveSettings(readSettings()), 400); } });
    form.addEventListener('change', (e) => { if (!e.target.matches('input[type="text"], textarea')) saveSettings(readSettings()); });
    $('#delete-all').addEventListener('click', async () => { if (await confirm('Delete all meetings?', 'Every captured meeting on this computer will be removed, except a call that is live now. Files you saved or downloaded stay.', 'Delete all')) { send({ type: 'delete-all' }); toast('All meetings deleted.'); } });
    sd.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      try {
        if (b.dataset.f === 'choose') { await chooseFolder(); fillSettings(); renderHead(); }
        else if (b.dataset.f === 'forget') { await forgetFolder(); fillSettings(); }
      } catch (err) { if (err && err.name !== 'AbortError') toast(String(err.message || err)); }
    });
  }
  function fillSettings() {
    const form = $('#settings-form'); if (!form) return;
    const s = state.settings;
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') el.checked = !!s[el.name];
      else if (el.type === 'radio') el.checked = s[el.name] === el.value;
      else if (document.activeElement !== el) el.value = s[el.name];
    }
    const row = $('#folder-row');
    if (row) row.innerHTML = state.folder ? `<code>${esc(state.folder.name)}</code><button type="button" class="btn sm" data-f="choose">Change</button><button type="button" class="btn sm" data-f="forget">Forget</button>` : `<span class="help">No folder chosen yet.</span><button type="button" class="btn sm" data-f="choose" ${'showDirectoryPicker' in window ? '' : 'disabled'}>Choose folder</button>`;
    const auto = $('#s-autoFolder'); if (auto) auto.disabled = !state.folder;
  }
  function readSettings() {
    const form = $('#settings-form'); const out = { ...state.settings };
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else if (el.type === 'number') { const n = Number(el.value); if (Number.isFinite(n)) out[el.name] = n; }
      else out[el.name] = el.value;
    }
    return out;
  }
  function saveSettings(patch) { state.settings = C.settingsWithDefaults({ ...state.settings, ...patch }); send({ type: 'settings', settings: state.settings }); if (state.current) renderHead(); }
  $('#settings-btn').addEventListener('click', openSettings);

  // ------------------------------------------------------------------ toast
  let toastTimer = null;
  function toast(text, action) {
    toastEl.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    if (action) toastEl.querySelector('button').addEventListener('click', () => { action.run(); hide(); });
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    const hide = () => toastEl.classList.remove('show');
    toastTimer = setTimeout(hide, action ? 8000 : 4500);
  }

  document.addEventListener('keydown', (e) => { if (e.key === '/' && !e.target.matches('input, textarea') && !document.querySelector('dialog[open]')) { e.preventDefault(); searchEl.focus(); } });

  connect();
  loadFolder();
  route();
})();
