// The captures page. One column: the index of meetings by day, or one meeting as a document, with the
// words people said, the snapshots in place where they were taken, and what to do with it (open in
// Claude, copy, one ZIP, save to a folder). Data is read straight from IndexedDB; live changes and
// commands go through a port to the worker. The look is explained in docs/DESIGN.md.
(() => {
  const C = window.MCC, S = C.store;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = C.esc;
  const VERSION = chrome.runtime.getManifest().version;
  const REPO = 'https://github.com/jeshwanthshivasai/meet-capture-for-claude';
  const main = $('#main'), toastEl = $('#toast'), crumb = $('#crumb');
  const GAP_MS = 180000; // three minutes without a caption line is shown as a gap in the record
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ICONS = {
    claude: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3"/><rect x="4" y="8" width="12" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    zip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M4 8a1 1 0 0 1 1-1h2.5l1.5-2h6l1.5 2H19a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8z"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  const state = {
    meetings: [], live: [], settings: C.settingsWithDefaults(null), exporting: [], error: '', gotState: false,
    current: null, lines: new Map(), snaps: new Map(), marks: new Map(), loading: new Map(), status: new Map(), tidy: [],
    search: '', follow: true, folder: null, menuOpen: false, lightbox: null, autoSaved: new Set(),
    hidden: new Set(), pendingDelete: new Map(), strip: { hoverX: null, cursor: 0 },
  };

  // ------------------------------------------------------------------ words
  /** 27 s · 23 min · 1 h 5 min */
  const nice = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); if (s < 60) return `${s} s`; const m = Math.round(s / 60); if (m < 60) return `${m} min`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; };
  const longDate = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const joinNames = (a) => a.length < 3 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
  const reasonText = (s) => `${s.reason}${s.source ? ' · ' + s.source : ''}`;
  const meetingById = (id) => state.meetings.find((m) => m.id === id);
  const isLive = (m) => m && (m.status === 'live' || state.live.some((l) => l.meetingId === m.id));
  const titleOf = (m) => C.titleOf(m);
  const people = (m) => [...new Set((m.participants || []).map((p) => C.speakerAlias(p, C.selfName(m, state.settings))))];
  const endOf = (m) => (isLive(m) ? Date.now() : (m.endedAt || m.startedAt));

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
        if (state.current && !state.meetings.some((x) => x.id === state.current)) { renderMain(); break; }
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
        const marks = state.marks.get(m.meetingId);
        if (marks && !marks.includes(m.snapshot.takenAt)) { marks.push(m.snapshot.takenAt); updateMini(m.meetingId); }
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
      case 'settings': state.settings = C.settingsWithDefaults(m.settings); if ($('#settings').open) fillSettings(); if (state.current) { renderHead(); scheduleTimeline(); } break;
      case 'show': if (m.meetingId) go(m.meetingId); break;
      case 'claude-opened': if (!m.fits) { copyTranscript(m.meetingId, true).then(() => toast('The transcript is too long to prefill. It is on your clipboard: paste it into the chat.')); } break;
      case 'usage': { const u = $('#usage'); if (u) u.textContent = `${(m.usage.bytes / 1048576).toFixed(1)} MB in ${plural(m.usage.snapshots, 'snapshot')}`; break; }
      default: break;
    }
  }

  // ------------------------------------------------------------------ routing: the index, or one meeting
  const idFromHash = () => { const m = /[#&]m=([^&]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; };
  function go(id) { const h = id ? '#m=' + encodeURIComponent(id) : ''; if (location.hash !== h) location.hash = h; else route(); }
  function route() {
    const id = idFromHash();
    state.current = id;
    state.menuOpen = false;
    state.strip = { hoverX: null, cursor: 0 };
    crumb.hidden = !id;
    renderMain();
    if (id) { loadMeeting(id).then(() => { if (state.current === id) { renderTimeline(); renderHead(); maybeAutoSave(); } }); window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  }
  window.addEventListener('hashchange', route);

  async function loadMeeting(id) {
    if (state.lines.has(id)) return;
    if (state.loading.has(id)) return state.loading.get(id);
    const p = (async () => {
      const [lines, snaps] = await Promise.all([S.getLines(id), S.getSnapshots(id)]);
      state.lines.set(id, lines); state.snaps.set(id, snaps); state.marks.set(id, snaps.map((s) => s.takenAt));
    })().catch((e) => { toast('Could not read this meeting: ' + e.message); }).finally(() => state.loading.delete(id));
    state.loading.set(id, p);
    return p;
  }

  const skeleton = () => '<div class="page" aria-busy="true"><div class="skel t"></div><div class="skel l"></div><div class="skel l"></div></div>';

  // ------------------------------------------------------------------ the index
  function dayLabel(ts) {
    const d = new Date(ts), now = new Date();
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, now)) return 'Today';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  function renderIndex() {
    document.title = 'Meet Capture';
    if (state.error) { main.innerHTML = `<div class="hero"><h1>Storage problem</h1><p>${esc(state.error)}</p></div>`; return; }
    if (!state.gotState) { main.innerHTML = skeleton(); return; }
    if (!state.meetings.some((m) => !state.hidden.has(m.id))) {
      main.innerHTML = `<div class="hero"><h1>Nothing captured yet.</h1><p>Join a Google Meet call. The capture button sits in Meet's bar next to Chat, captions switch on by themselves, and the meeting is here the moment you leave.</p><p><a class="btn primary" href="https://meet.google.com/" target="_blank" rel="noopener">Open Google Meet</a></p></div>`;
      return;
    }
    if (!$('#index')) main.innerHTML = `<div class="page index" id="index"><div class="index-h"><h1>Meetings</h1><label class="search">${ICONS.search}<input id="search" type="search" placeholder="Find a meeting" aria-label="Find a meeting" autocomplete="off" value="${esc(state.search)}"></label></div><div id="groups"></div></div>`;
    renderGroups();
  }
  function renderGroups() {
    const g = $('#groups'); if (!g) return;
    const q = state.search.trim().toLowerCase();
    const items = state.meetings.filter((m) => !state.hidden.has(m.id) && (!q || `${titleOf(m)} ${m.code || ''} ${people(m).join(' ')}`.toLowerCase().includes(q)));
    if (!items.length) { g.innerHTML = `<p class="none">No meeting matches “${esc(state.search.trim())}”.</p>`; return; }
    let html = '', day = '';
    for (const m of items) {
      const d = dayLabel(m.startedAt);
      if (d !== day) { day = d; html += `<h2 class="day">${esc(d)}</h2>`; }
      const live = isLive(m), end = endOf(m), names = people(m);
      const when = live ? `<span class="live"><span class="live-dot"></span>Live</span> · ${esc(C.fmtClock(m.startedAt))} · ${esc(nice(end - m.startedAt))} so far` : `${esc(C.fmtClock(m.startedAt))} · ${esc(nice(end - m.startedAt))}`;
      html += `<a class="row" href="#m=${encodeURIComponent(m.id)}" data-id="${esc(m.id)}"><span class="rt">${esc(titleOf(m))}</span><span class="rw">${when}</span><span class="rs">${mini(m)}<span class="rp">${esc(names.join(', '))}</span></span></a>`;
    }
    g.innerHTML = html;
    loadMarks(items);
  }
  /** Each meeting as a small line: its length, with a mark at each snapshot. Ninety minutes fill it. */
  function mini(m) {
    const dur = Math.max(endOf(m) - m.startedAt, 60000);
    const w = Math.round(16 + 184 * Math.min(1, dur / 5400000));
    return `<span class="mini${isLive(m) ? ' live' : ''}" style="width:${w}px" data-mini="${esc(m.id)}" aria-hidden="true">${miniTicks(m, w)}</span>`;
  }
  function miniTicks(m, w) {
    const dur = Math.max(endOf(m) - m.startedAt, 60000);
    let last = -9, out = '';
    for (const t of state.marks.get(m.id) || []) {
      const x = Math.round(Math.max(0, Math.min(1, (t - m.startedAt) / dur)) * w);
      if (x - last < 3) continue;
      last = x; out += `<i style="left:${x}px"></i>`;
    }
    return out;
  }
  function updateMini(id) { const el = document.querySelector(`[data-mini="${CSS.escape(id)}"]`); const m = meetingById(id); if (el && m) el.innerHTML = miniTicks(m, el.offsetWidth || 100); }
  async function loadMarks(items) {
    for (const m of items) {
      if (state.marks.has(m.id)) continue;
      state.marks.set(m.id, []);
      try { state.marks.set(m.id, await S.snapshotTimes(m.id)); } catch (e) { /* the line stays plain */ }
      updateMini(m.id);
    }
  }
  main.addEventListener('input', (e) => { if (e.target.id === 'search') { state.search = e.target.value; renderGroups(); } });

  // ------------------------------------------------------------------ one meeting
  function renderMain() {
    if (!state.current) { renderIndex(); return; }
    const m = meetingById(state.current);
    if (!m) { main.innerHTML = state.gotState ? `<div class="hero"><h1>That meeting is gone.</h1><p>It was deleted, or cleaned up after ${state.settings.keepDays} days.</p><p><a class="btn primary" href="#">All meetings</a></p></div>` : skeleton(); return; }
    document.title = `${titleOf(m)} · Meet Capture`;
    main.innerHTML = `<article class="page">
      <div id="head"></div>
      <div class="strip-wrap" id="strip"></div>
      <div id="actions"></div>
      <div id="callout"></div>
      <div class="tl" id="tl"></div>
      <div class="follow" id="follow" hidden><button class="btn dark sm" data-act="follow">Jump to now ↓</button></div>
    </article>`;
    renderHead();
    renderTimeline();
  }

  function renderHead() {
    const head = $('#head'); const m = meetingById(state.current);
    if (!head || !m) return;
    if (head.querySelector('.title-edit')) return; // a rename is being typed: leave the header alone until it ends
    const live = isLive(m), st = state.status.get(m.id), end = endOf(m), names = people(m);
    const captions = !st ? '' : st.regionFound ? 'captions flowing' : st.captionsOn === false ? 'captions are off' : 'waiting for captions';
    head.innerHTML = `<h1 class="title" id="title">${esc(titleOf(m))}</h1>
      <p class="meta">${live ? `<span class="live"><span class="live-dot"></span>Live · <span id="elapsed">${C.fmtElapsed(end - m.startedAt)}</span>${captions ? ` · ${captions}` : ''}</span>` : ''}<span>${esc(longDate(m.startedAt))}</span><span>${esc(C.fmtClock(m.startedAt))}–${live ? 'now' : esc(C.fmtClock(end))}</span>${live ? '' : `<span>${esc(nice(end - m.startedAt))}</span>`}<span>${plural(m.lineCount || 0, 'line')} · ${plural(m.snapshotCount || 0, 'snapshot')}</span></p>
      ${names.length ? `<p class="people">${esc(joinNames(names))}</p>` : ''}`;
    document.title = `${titleOf(m)} · Meet Capture`;
    renderActions(m, live);
    renderCallout(m);
  }
  function renderActions(m, live) {
    const a = $('#actions'); if (!a) return;
    const exporting = state.exporting.includes(m.id);
    const folderLabel = state.folder ? `Save to ${state.folder.name}` : 'Save to folder…';
    a.innerHTML = `<div class="actions">
        ${live ? `<button class="btn primary" data-act="snapshot">${ICONS.camera}Snapshot now</button><button class="btn" data-act="focus">Go to the call</button>` : `<button class="btn primary" data-act="claude">${ICONS.claude}Open in Claude</button>
        <button class="btn" data-act="copy">${ICONS.copy}Copy transcript</button>
        <button class="btn" data-act="zip" ${exporting ? 'disabled' : ''}>${ICONS.zip}${exporting ? 'Preparing the ZIP…' : m.zipAt ? 'Save ZIP again' : 'Save ZIP'}</button>
        <button class="btn" data-act="folder" ${'showDirectoryPicker' in window ? '' : 'hidden'}>${ICONS.folder}${esc(folderLabel)}</button>`}
        <div class="menu"><button class="ib" data-act="menu" aria-label="More" aria-haspopup="menu" aria-expanded="${state.menuOpen}">${ICONS.more}</button>${state.menuOpen ? `<ul class="menu-list" role="menu">
          ${live ? `<li><button role="menuitem" data-act="copy">Copy the transcript so far</button></li><li><button role="menuitem" data-act="zip" ${exporting ? 'disabled' : ''}>${exporting ? 'Preparing the ZIP…' : 'Save a ZIP so far'}</button></li>${'showDirectoryPicker' in window ? `<li><button role="menuitem" data-act="folder">${esc(folderLabel)} so far</button></li>` : ''}<li><hr></li>` : ''}
          <li><button role="menuitem" data-act="rename">Rename</button></li>
          ${m.url ? `<li><button role="menuitem" data-act="meet-link">Open in Google Meet</button></li>` : ''}
          ${live ? `<li><button role="menuitem" data-act="open-panel">Open the panel in Meet</button></li><li><button role="menuitem" data-act="end">Stop capturing</button></li>` : ''}
          <li><hr></li><li><button role="menuitem" class="danger" data-act="delete">Delete</button></li></ul>` : ''}</div>
      </div>
      ${live ? '' : '<p class="leaves">Open in Claude starts a new claude.ai chat with the transcript in the message box. Nothing else is sent anywhere; the snapshots travel in the ZIP or the folder.</p>'}
      ${m.savedAt ? `<p class="note">Saved to ${esc(m.savedPath || m.savedFolder)} at ${esc(C.fmtClock(m.savedAt))}${m.zipAt ? ` · ZIP at ${esc(C.fmtClock(m.zipAt))}` : ''}</p>` : m.zipAt ? `<p class="note">ZIP saved at ${esc(C.fmtClock(m.zipAt))}: ${esc(m.zipPath || m.zipFile)}</p>` : ''}`;
  }
  /** The one or two things that need the person, in words, and only when they do. */
  function renderCallout(m) {
    const c = $('#callout'); if (!c) return;
    if (isLive(m)) { c.innerHTML = ''; return; }
    const lines = state.lines.get(m.id);
    if (lines && !lines.length && !(m.snapshotCount || 0)) { c.innerHTML = '<p class="notice">Nothing was captured in this call: captions were off, and no screen was shared. Captions must be on in Meet for a transcript; the panel in Meet shows both as they happen.</p>'; return; }
    if (state.settings.autoFolder && state.folder && !m.savedAt && state.autoSaved.has(m.id + ':denied')) {
      c.innerHTML = `<div class="ask"><span class="grow">Chrome needs a click before this page may write into <b>${esc(state.folder.name)}</b>.</span><button class="btn sm" data-act="folder">Save now</button></div>`; return;
    }
    if (!state.settings.myName && lines && C.tidyLines(C.withNames(lines, m, state.settings)).some((l) => C.SELF_WORDS.test(l.speaker))) {
      c.innerHTML = '<div class="ask"><span class="grow">Meet labelled your own lines “You”. Add your name once, and every transcript uses it.</span><button class="btn sm" data-act="myname">Add my name</button></div>'; return;
    }
    c.innerHTML = '';
  }
  setInterval(() => {
    const m = meetingById(state.current);
    if (m && isLive(m)) { const el = $('#elapsed'); if (el) el.textContent = C.fmtElapsed(Date.now() - m.startedAt); renderStrip(); }
    if (!state.current && state.live.length && $('#groups') && Date.now() % 5000 < 1000) renderGroups();
  }, 1000);

  // ------------------------------------------------------------------ the record
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
  const lineEnd = (l) => Math.max(l.updatedAt || 0, l.startedAt + 2000);
  /** Lines, snapshots and gaps in time order. A gap is three minutes or more without a caption line. */
  function events(m, tidy, snaps) {
    const ev = [];
    let prevEnd = m.startedAt;
    for (const l of tidy) {
      if (l.startedAt - prevEnd >= GAP_MS) ev.push({ k: 'gap', t: prevEnd + 1, ms: l.startedAt - prevEnd });
      ev.push({ k: 'line', t: l.startedAt, l });
      prevEnd = lineEnd(l);
    }
    if (!isLive(m) && tidy.length && m.endedAt && m.endedAt - prevEnd >= GAP_MS) ev.push({ k: 'gap', t: prevEnd + 1, ms: m.endedAt - prevEnd });
    snaps.forEach((s, i) => ev.push({ k: 'snap', t: s.takenAt, s, n: i + 1 }));
    ev.sort((a, b) => a.t - b.t);
    return ev;
  }
  function figure(s, n) {
    return `<div class="figure" id="snap-${n}" data-n="${n}"><time>${esc(C.fmtClock(s.takenAt))}</time><figure><img data-key="${esc(s.key)}" src="${esc(s.thumb || '')}" alt="Snapshot ${n}" data-act="view" data-n="${n}" width="1600" height="900"><figcaption><b>Snapshot ${n}</b><span>${esc(C.fmtTime(s.takenAt))} · ${esc(reasonText(s))}</span><span class="grow"></span><button class="btn sm" data-act="copy-image" data-n="${n}">Copy image</button></figcaption></figure></div>`;
  }
  function renderTimeline() {
    const tl = $('#tl'), m = meetingById(state.current);
    if (!tl || !m) return;
    const lines = state.lines.get(m.id), snaps = state.snaps.get(m.id) || [];
    if (!lines) { tl.innerHTML = ''; state.tidy = []; renderStrip(); return; }
    const tidy = C.tidyLines(C.withNames(lines, m, state.settings));
    state.tidy = tidy;
    let html = '', open = null;
    const closeTurn = () => { if (open) { html += '</div>'; open = null; } };
    if (!tidy.length && snaps.length && !isLive(m)) html += '<p class="empty-tl">No captions were captured: captions were off in Meet. The snapshots are here.</p>';
    for (const e of events(m, tidy, snaps)) {
      if (e.k === 'line') {
        if (open !== e.l.speaker) { closeTurn(); open = e.l.speaker; html += `<div class="turn"><div class="who"><span class="name">${esc(e.l.speaker)}</span><time class="when">${esc(C.fmtClock(e.t))}</time></div>`; }
        html += `<div class="line" data-t="${e.t}"><time title="${esc(C.fmtTime(e.t))}">${esc(C.fmtClock(e.t))}</time><p class="text">${esc(e.l.text)}</p></div>`;
      } else if (e.k === 'snap') { closeTurn(); html += figure(e.s, e.n); }
      else { closeTurn(); html += `<div class="gap"><span>${esc(nice(e.ms))} without captions</span></div>`; }
    }
    closeTurn();
    if (!tidy.length && isLive(m)) html += '<p class="empty-tl">Lines appear here as people speak.</p>';
    tl.innerHTML = html;
    for (const img of tl.querySelectorAll('img[data-key]')) lazy.observe(img);
    renderStrip();
    if (isLive(m) && state.follow) scrollToEnd();
    requestAnimationFrame(updateFollow);
  }
  const nearBottom = () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 120;
  const scrollToEnd = () => window.scrollTo({ top: document.documentElement.scrollHeight });
  /** While a call is live the page keeps up with new lines unless you scrolled up; then a chip offers the way back. */
  function updateFollow() {
    const f = $('#follow'), m = meetingById(state.current);
    if (!f) return;
    f.hidden = !(m && isLive(m) && !nearBottom());
  }
  window.addEventListener('scroll', () => { state.follow = nearBottom(); updateFollow(); }, { passive: true });

  // ------------------------------------------------------------------ the meeting as one line
  function stripGeom() {
    const m = meetingById(state.current); const el = $('#strip');
    if (!m || !el) return null;
    const t0 = m.startedAt, t1 = endOf(m);
    return { m, el, t0, t1, dur: Math.max(t1 - t0, 60000), snaps: state.snaps.get(m.id) || [], live: isLive(m) };
  }
  function renderStrip() {
    const g = stripGeom(); if (!g) return;
    if (!state.lines.has(g.m.id)) { g.el.innerHTML = ''; return; }
    const pos = (t) => Math.max(0, Math.min(1, (t - g.t0) / g.dur)) * 100;
    const cov = [];
    for (const l of state.tidy) { const a = l.startedAt, b = lineEnd(l), last = cov[cov.length - 1]; if (last && a - last[1] < GAP_MS) last[1] = Math.max(last[1], b); else cov.push([a, b]); }
    const covHtml = cov.map(([a, b]) => `<i class="cov" style="left:${pos(a).toFixed(2)}%;width:${Math.max(0.4, pos(b) - pos(a)).toFixed(2)}%"></i>`).join('');
    const tickHtml = g.snaps.map((s, i) => `<i class="tick${state.strip.cursor === i + 1 ? ' on' : ''}" style="left:${pos(s.takenAt).toFixed(2)}%" data-n="${i + 1}"></i>`).join('');
    const label = `The meeting as a line: ${nice(g.dur)}${g.snaps.length ? `, ${plural(g.snaps.length, 'snapshot')}` : ''}. Arrow keys move between snapshots, Enter goes there.`;
    g.el.innerHTML = `<div class="strip" tabindex="0" role="group" aria-label="${esc(label)}"><div class="track">${covHtml}${tickHtml}${g.live ? `<i class="now" style="left:${pos(g.t1).toFixed(2)}%"></i>` : ''}</div>
      <div class="labels"><span>${esc(C.fmtClock(g.t0))}</span><span class="mid" data-el="readout"></span><span>${g.live ? 'now' : esc(C.fmtClock(g.t1))}</span></div>
      <div class="tip" data-el="tip" hidden><img alt=""><span></span></div></div>`;
    if (state.strip.hoverX != null) stripHover(state.strip.hoverX); else if (state.strip.cursor) stripShow(state.strip.cursor - 1);
  }
  const speakerAt = (t) => { let who = ''; for (const l of state.tidy) { if (l.startedAt > t) break; if (lineEnd(l) >= t - 15000) who = l.speaker; } return who ? ' · ' + who : ''; };
  /** Points the readout and the preview at snapshot i, or clears them. */
  function stripShow(i, t) {
    const g = stripGeom(); if (!g) return;
    const readout = g.el.querySelector('[data-el="readout"]'), tip = g.el.querySelector('[data-el="tip"]');
    if (!readout) return;
    for (const k of g.el.querySelectorAll('.tick')) k.classList.toggle('on', Number(k.dataset.n) === i + 1);
    if (i >= 0 && g.snaps[i]) {
      const s = g.snaps[i], x = ((s.takenAt - g.t0) / g.dur) * g.el.clientWidth;
      readout.textContent = `Snapshot ${i + 1} · ${C.fmtTime(s.takenAt)} · ${reasonText(s)}`;
      tip.hidden = false; tip.querySelector('img').src = s.thumb || ''; tip.querySelector('span').textContent = `Snapshot ${i + 1} · ${C.fmtClock(s.takenAt)}`;
      tip.style.left = `${Math.max(80, Math.min(g.el.clientWidth - 80, x))}px`;
    } else { readout.textContent = t == null ? '' : `${C.fmtClock(t)}${speakerAt(t)}`; tip.hidden = true; }
  }
  function nearestSnap(g, frac) {
    const x = frac * g.el.clientWidth; let best = -1, bd = 9;
    g.snaps.forEach((s, i) => { const d = Math.abs(((s.takenAt - g.t0) / g.dur) * g.el.clientWidth - x); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function stripHover(frac) {
    const g = stripGeom(); if (!g) return;
    state.strip.hoverX = frac;
    const i = nearestSnap(g, frac);
    stripShow(i, g.t0 + frac * g.dur);
  }
  function stripLeave() { state.strip.hoverX = null; stripShow(state.strip.cursor ? state.strip.cursor - 1 : -1); }
  function fracOf(e) { const tr = e.currentTarget; const r = tr.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
  function flash(el) { if (!el) return; el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 1400); }
  function jumpToSnap(n) { const el = $(`#snap-${n}`); if (!el) return; state.strip.cursor = n; el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }); flash(el); }
  function jumpToTime(t) {
    const lines = [...document.querySelectorAll('.line[data-t]')];
    const el = lines.find((l) => Number(l.dataset.t) >= t) || lines[lines.length - 1];
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }); flash(el);
  }
  main.addEventListener('pointermove', (e) => { if (e.target.closest('.track')) { const tr = e.target.closest('.track'); const r = tr.getBoundingClientRect(); stripHover(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); } });
  main.addEventListener('pointerout', (e) => { if (e.target.closest && e.target.closest('.track') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.track'))) stripLeave(); });
  main.addEventListener('keydown', (e) => {
    if (!e.target.classList || !e.target.classList.contains('strip')) return;
    const g = stripGeom(); if (!g || !g.snaps.length) return;
    const n = state.strip.cursor;
    if (e.key === 'ArrowRight') { state.strip.cursor = Math.min(g.snaps.length, n + 1); stripShow(state.strip.cursor - 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { state.strip.cursor = Math.max(1, n - 1); stripShow(state.strip.cursor - 1); e.preventDefault(); }
    else if (e.key === 'Home') { state.strip.cursor = 1; stripShow(0); e.preventDefault(); }
    else if (e.key === 'End') { state.strip.cursor = g.snaps.length; stripShow(g.snaps.length - 1); e.preventDefault(); }
    else if ((e.key === 'Enter' || e.key === ' ') && n) { jumpToSnap(n); e.preventDefault(); }
  });

  // ------------------------------------------------------------------ actions
  main.addEventListener('click', async (e) => {
    const tr = e.target.closest('.track');
    if (tr) { const g = stripGeom(); if (!g) return; const frac = fracOf({ currentTarget: tr, clientX: e.clientX }); const i = nearestSnap(g, frac); if (i >= 0) jumpToSnap(i + 1); else jumpToTime(g.t0 + frac * g.dur); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const m = meetingById(state.current);
    const act = b.dataset.act;
    try {
      if (act === 'home') return go('');
      if (!m) return;
      if (act === 'claude') { send({ type: 'open-claude', meetingId: m.id }); toast('Opening Claude with the transcript…'); }
      else if (act === 'copy') { closeMenu(); await copyTranscript(m.id); toast('Transcript copied. Paste it into Claude.'); }
      else if (act === 'zip') { closeMenu(); state.exporting.push(m.id); renderHead(); send({ type: 'export', meetingId: m.id }); }
      else if (act === 'folder') { closeMenu(); await saveToFolder(m.id, { silent: false }); }
      else if (act === 'snapshot') send({ type: 'snapshot-now', tabId: m.tabId });
      else if (act === 'focus') send({ type: 'focus-meet', meetingId: m.id });
      else if (act === 'open-panel') { send({ type: 'open-panel', tabId: m.tabId }); send({ type: 'focus-meet', meetingId: m.id }); closeMenu(); }
      else if (act === 'end') { closeMenu(); if (await confirm('Stop capturing this call?', 'What was captured so far is kept. The call itself continues.', 'Stop capturing')) send({ type: 'end-meeting', meetingId: m.id }); }
      else if (act === 'menu') { state.menuOpen = !state.menuOpen; renderHead(); if (state.menuOpen) $('.menu-list button') && $('.menu-list button').focus(); }
      else if (act === 'rename') { closeMenu(); startRename(m); }
      else if (act === 'meet-link') { closeMenu(); chrome.tabs.create({ url: m.url }); }
      else if (act === 'delete') { closeMenu(); deleteWithUndo(m); }
      else if (act === 'myname') { openSettings(); const f = $('#s-myName'); if (f) f.focus(); }
      else if (act === 'view') openLightbox(m.id, Number(b.dataset.n));
      else if (act === 'copy-image') { await copyImage(m.id, Number(b.dataset.n)); toast('Image copied. Paste it into the chat.'); }
      else if (act === 'follow') { state.follow = true; scrollToEnd(); updateFollow(); }
    } catch (err) { toast(String((err && err.message) || err)); }
  });
  function closeMenu() { if (state.menuOpen) { state.menuOpen = false; renderHead(); } }
  document.addEventListener('click', (e) => { if (state.menuOpen && !e.target.closest('.menu')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.menuOpen) closeMenu(); });
  main.addEventListener('dblclick', (e) => { if (e.target.closest('#title')) { const m = meetingById(state.current); if (m) startRename(m); } });

  /** A delete can be undone for eight seconds; only then is the meeting removed from storage. */
  function deleteWithUndo(m) {
    state.hidden.add(m.id);
    go('');
    const timer = setTimeout(() => { state.pendingDelete.delete(m.id); send({ type: 'delete', meetingId: m.id }); }, 8000);
    state.pendingDelete.set(m.id, timer);
    toast(`Deleted “${titleOf(m)}”.`, { label: 'Undo', run: () => { clearTimeout(timer); state.pendingDelete.delete(m.id); state.hidden.delete(m.id); if (!state.current) { const i = $('#index'); if (i) renderGroups(); else renderMain(); } } });
  }
  window.addEventListener('pagehide', () => { for (const [id, t] of state.pendingDelete) { clearTimeout(t); send({ type: 'delete', meetingId: id }); } state.pendingDelete.clear(); });

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
      if (save && title && title !== titleOf(m)) { m.title = title; m.renamed = true; send({ type: 'rename', meetingId: m.id, title }); }
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
    toast(`Saved ${plural(files.length, 'file')} to ${handle.name}/${sub}`);
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
      <div class="bar"><span class="cap">Snapshot ${n} of ${snaps.length} · ${esc(C.fmtTime(s.takenAt))} · ${esc(reasonText(s))} · ${s.width}×${s.height}</span>
        <button class="btn sm" data-lb="copy">${ICONS.copy}Copy image</button><button class="btn sm" data-lb="download">${ICONS.zip}Download</button></div>
      <button class="nav prev" data-lb="prev" aria-label="Previous" ${n > 1 ? '' : 'hidden'}>${ICONS.back}</button>
      <button class="nav next" data-lb="next" aria-label="Next" ${n < snaps.length ? '' : 'hidden'} style="transform:translateY(-50%) scaleX(-1)">${ICONS.back}</button>
      <button class="ib close" data-lb="close" aria-label="Close">${ICONS.close}</button></div>`;
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

  // ------------------------------------------------------------------ confirm (only for what cannot be undone)
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
    if (sd.open) return;
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
    if (row) row.innerHTML = state.folder ? `<code>${esc(state.folder.name)}</code><button type="button" class="btn sm" data-f="choose">Change</button><button type="button" class="btn sm" data-f="forget">Forget</button>` : `<span class="help">No folder chosen yet.</span><button type="button" class="btn sm" data-f="choose" ${'showDirectoryPicker' in window ? '' : 'disabled'}>Choose folder…</button>`;
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
  function saveSettings(patch) { state.settings = C.settingsWithDefaults({ ...state.settings, ...patch }); send({ type: 'settings', settings: state.settings }); if (state.current) { renderHead(); scheduleTimeline(); } }
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

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.target.matches('input, textarea') || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (state.current) go('');
    const s = $('#search'); if (s) s.focus();
  });

  connect();
  loadFolder();
  route();
})();
