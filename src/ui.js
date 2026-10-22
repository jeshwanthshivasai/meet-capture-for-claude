// The capture UI inside Google Meet: a button in Meet's own bottom bar, a panel docked on the right
// like Meet's People and Chat panels, and a card on the "You left" page. Everything lives in shadow
// roots, so Meet's styles do not reach it and its styles do not reach Meet. The content script owns
// the data and drives this through update(); this file only draws.
(function (root) {
  const NS = (root.MCC = root.MCC || {});
  const esc = NS.esc;
  const FONT = '"Google Sans Text","Google Sans",Roboto,"Segoe UI",system-ui,-apple-system,sans-serif';
  const ICON = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M545.8 1313.2Q438.6 1264.6 403.7 1228Q368.8 1191.5 368.8 1143.5Q368.8 1112.5 390.7 1087.9Q412.6 1063.2 440.7 1042.6Q468.8 1022 490.7 1003.8Q512.6 985.6 512.6 967.3Q512.6 885.8 457.6 830Q402.5 774.1 304.6 774.1Q202.8 774.1 145.5 829.2Q88.3 884.2 88.3 982.7Q88.3 1085.1 123.7 1165.8Q159.2 1246.6 244.9 1313.1Q330.6 1379.6 481.8 1438.7ZM1062.5 1313.2Q955.2 1264.6 920.3 1228Q885.4 1191.5 885.4 1143.5Q885.4 1112.5 907.4 1087.9Q929.3 1063.2 957.3 1042.6Q985.4 1022 1007.3 1003.8Q1029.2 985.6 1029.2 967.3Q1029.2 885.8 974.2 830Q919.2 774.1 821.2 774.1Q719.5 774.1 662.2 829.2Q604.9 884.2 604.9 982.7Q604.9 1085.1 640.4 1165.8Q675.9 1246.6 761.6 1313.1Q847.3 1379.6 998.4 1438.7Z" transform="translate(3 5.8602) scale(0.018477 -0.018477) translate(-88.3 -1438.7)" fill="currentColor"/></svg>'; // the extension's mark: the opening quotation mark from store/assets/icon.js
  const CLOSE = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>';
  const CAMERA = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M9 3 7.17 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.17L15 3H9zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';
  const PALETTE = ['#0b57d0', '#146c2e', '#b3261e', '#7a4e00', '#6750a4', '#00677d', '#8e4585', '#3c6e00'];
  const colorFor = (name) => { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const initials = (name) => { const p = NS.normalize(name).split(' ').filter(Boolean); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); };

  const PANEL_CSS = `
    :host{all:initial}
    *,*::before,*::after{box-sizing:border-box}
    [hidden]{display:none!important}
    .panel{position:fixed;top:16px;right:16px;bottom:var(--bottom,96px);width:360px;max-width:calc(100vw - 32px);display:flex;flex-direction:column;background:#fff;color:#1f1f1f;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.3),0 4px 8px 3px rgba(0,0,0,.15);font:400 14px/20px ${FONT};z-index:1000;overflow:hidden;opacity:0;transform:translateX(24px);transition:opacity .18s,transform .22s cubic-bezier(.2,0,0,1);pointer-events:none}
    .panel.open{opacity:1;transform:none;pointer-events:auto}
    header{display:flex;align-items:center;gap:4px;padding:12px 8px 0 24px}
    h2{flex:1;margin:0;font:400 18px/24px "Google Sans",Roboto,${FONT};letter-spacing:0}
    .ib{all:unset;cursor:pointer;width:48px;height:48px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#444746}
    .ib:hover{background:rgba(31,31,31,.08)}.ib:focus-visible{outline:2px solid #0b57d0;outline-offset:-2px}
    .status{display:flex;align-items:center;gap:8px;padding:2px 24px 12px;font-size:12px;line-height:16px;color:#444746;flex-wrap:wrap}
    .dot{width:8px;height:8px;border-radius:50%;background:#dc362e;box-shadow:0 0 0 0 rgba(220,54,46,.5);animation:pulse 1.6s ease-out infinite}
    .dot.idle{background:#8e918f;animation:none}
    @keyframes pulse{to{box-shadow:0 0 0 7px rgba(220,54,46,0)}}
    .link{all:unset;cursor:pointer;color:#0b57d0;font-weight:500}.link:hover{text-decoration:underline}.link:focus-visible{outline:2px solid #0b57d0;border-radius:4px}
    .feed{flex:1;overflow-y:auto;padding:0 16px 12px 24px;overscroll-behavior:contain;scrollbar-width:thin}
    .empty{margin:32px 8px;text-align:center;color:#444746}
    .empty b{display:block;color:#1f1f1f;font-weight:500;margin-bottom:4px}
    .msg{display:flex;gap:12px;margin-top:14px}
    .msg.cont{margin-top:4px}
    .av{flex:none;width:32px;height:32px;border-radius:50%;color:#fff;font:500 12px/32px ${FONT};text-align:center;overflow:hidden}
    .av img{width:100%;height:100%;object-fit:cover;display:block}
    .cont .av{visibility:hidden;height:0}
    .body{flex:1;min-width:0}
    .who{display:flex;gap:8px;align-items:baseline;line-height:20px}
    .name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .time{color:#444746;font-size:12px;flex:none}
    .text{margin-top:1px;white-space:pre-wrap;overflow-wrap:anywhere}
    .text.live{color:#444746}
    .text.live::after{content:"";display:inline-block;width:6px;height:6px;margin-left:6px;border-radius:50%;background:#0b57d0;vertical-align:middle;animation:blink 1s infinite}
    @keyframes blink{50%{opacity:.2}}
    .snap{margin:12px 0 0 44px;border:1px solid #c4c7c5;border-radius:8px;overflow:hidden;background:#f2f2f2}
    .snap img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#1f1f1f}
    .snap .cap{display:flex;gap:8px;padding:6px 10px;font-size:12px;line-height:16px;color:#444746}
    .snap .cap b{color:#1f1f1f;font-weight:500}
    footer{border-top:1px solid #e3e3e3;padding:12px 16px 16px 24px;display:flex;flex-direction:column;gap:10px;background:#fff}
    .row{display:flex;gap:8px;align-items:center}
    .btn{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 20px 0 16px;border-radius:20px;background:#0b57d0;color:#fff;font:500 14px/20px ${FONT};white-space:nowrap;transition:box-shadow .15s,background .15s}
    .btn:hover{background:#0842a0;box-shadow:0 1px 3px rgba(0,0,0,.3)}.btn:active{background:#062e6f}.btn:focus-visible{outline:2px solid #0b57d0;outline-offset:2px}
    .btn.flash{background:#146c2e}
    .sel{appearance:none;-webkit-appearance:none;cursor:pointer;flex:1;min-width:0;height:40px;padding:0 32px 0 14px;border:1px solid #747775;border-radius:20px;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23444746' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E") no-repeat right 8px center/20px;color:#1f1f1f;font:500 14px/20px ${FONT};text-overflow:ellipsis}
    .sel:hover{background-color:#f3f6fc}.sel:focus-visible{outline:2px solid #0b57d0;outline-offset:1px}
    .src{font-size:12px;line-height:16px;color:#444746;display:flex;gap:4px;align-items:center;min-width:0}
    .src span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
    .src select{appearance:none;-webkit-appearance:none;border:0;margin:0;cursor:pointer;flex:1;min-width:0;max-width:220px;padding:2px 18px 2px 2px;border-radius:4px;background:transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%230b57d0' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E") no-repeat right 0 center/16px;color:#0b57d0;font:500 12px/16px ${FONT};text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
    .src select:hover{background-color:#f3f6fc}.src select:focus-visible{outline:2px solid #0b57d0}
    .src .link{margin-left:auto;flex:none;white-space:nowrap;font-size:12px}
    .callout{background:#e8f0fe;color:#041e49;border-radius:8px;padding:10px 12px;font-size:13px;line-height:18px}
    .callout .btn{height:32px;padding:0 14px;margin-top:8px;font-size:13px}
    .callout.ok{background:#e6f4ea;color:#0d652d}
    .kbd{font:500 11px/16px ${FONT};color:#444746;border:1px solid #c4c7c5;border-radius:4px;padding:0 5px;margin-left:auto}
    @media (max-width:640px){.panel{left:16px;width:auto}}
    @media (prefers-reduced-motion:reduce){.panel{transition:none}.dot,.text.live::after{animation:none}}`;

  const BUTTON_CSS = `
    :host{all:initial;display:inline-block}
    .wrap{position:relative;display:inline-flex}
    button{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:20px;color:#e3e3e3;background:rgba(255,255,255,0);transition:background .15s}
    button:hover{background:rgba(232,234,237,.1)}
    button:focus-visible{outline:2px solid #a8c7fa;outline-offset:1px}
    button[aria-pressed="true"]{background:#a8c7fa;color:#062e6f}
    .badge{position:absolute;top:-2px;right:-2px;min-width:10px;height:10px;border-radius:5px;background:#dc362e;border:2px solid #202124;pointer-events:none;opacity:0;transition:opacity .2s}
    .badge.on{opacity:1}
    .tip{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);background:#3c4043;color:#e8eaed;font:500 12px/16px ${FONT};padding:6px 8px;border-radius:4px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .1s;z-index:2}
    .wrap:hover .tip,button:focus-visible~.tip{opacity:1}`;

  const CARD_CSS = `
    :host{all:initial}
    *,*::before,*::after{box-sizing:border-box}
    .card{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);display:flex;align-items:center;gap:16px;max-width:calc(100vw - 32px);padding:14px 16px 14px 20px;border-radius:12px;background:#fff;color:#1f1f1f;box-shadow:0 1px 3px rgba(0,0,0,.3),0 4px 8px 3px rgba(0,0,0,.15);font:400 14px/20px ${FONT};z-index:1000;animation:up .3s cubic-bezier(.2,0,0,1)}
    @keyframes up{from{opacity:0;transform:translate(-50%,16px)}}
    .ok{flex:none;width:40px;height:40px;border-radius:50%;background:#e6f4ea;color:#146c2e;display:flex;align-items:center;justify-content:center}
    .t{font-weight:500}.s{color:#444746;font-size:13px}
    .btn{all:unset;cursor:pointer;height:36px;padding:0 16px;border-radius:18px;background:#0b57d0;color:#fff;font:500 14px/20px ${FONT};white-space:nowrap;display:inline-flex;align-items:center}
    .btn:hover{background:#0842a0}.btn:focus-visible{outline:2px solid #0b57d0;outline-offset:2px}
    .btn.ghost{background:transparent;color:#0b57d0;border:1px solid #747775}.btn.ghost:hover{background:#f3f6fc}
    .x{all:unset;cursor:pointer;width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#444746}.x:hover{background:rgba(31,31,31,.08)}
    @media (max-width:640px){.card{flex-wrap:wrap}}`;

  /**
   * Creates the in-Meet UI. `on` holds the callbacks: snapshot(), setMode(mode), chooseSource(id),
   * captureShare(), openApp(), enableCaptions(), openClaude(), toggled(open).
   */
  function createMeetUI(on) {
    const doc = root.document;
    let host = null, sh = null, feed = null, els = {};
    let button = null, bsh = null;
    let open = false, feedKeys = new Map(), lastSpeakerKey = '', follow = true, card = null;
    const lastState = { lines: [], snapshots: [] };

    function ensurePanel() {
      if (host && host.isConnected) return;
      if (host) { doc.body.appendChild(host); return; }
      host = doc.createElement('div'); host.id = 'meet-capture-panel';
      sh = host.attachShadow({ mode: 'open' });
      sh.innerHTML = `<style>${PANEL_CSS}</style>
        <section class="panel" role="complementary" aria-label="Meet Capture" aria-hidden="true">
          <header><h2>Meet Capture</h2><button class="ib" data-act="close" aria-label="Close">${CLOSE}</button></header>
          <div class="status"><span class="dot"></span><span data-el="status"></span><button class="link" data-act="cc" hidden>Turn on captions</button></div>
          <div class="feed" data-el="feed" aria-live="polite" aria-relevant="additions text"><div class="empty" data-el="empty"></div></div>
          <footer>
            <div data-el="callout" hidden></div>
            <div class="row"><button class="btn" data-act="snapshot" title="Take a snapshot of the shared screen now (Alt+Shift+S)">${CAMERA}Snapshot</button>
              <select class="sel" data-el="mode" aria-label="Automatic snapshots"><option value="change">Auto: on change</option><option value="both">Auto: change + timer</option><option value="timer">Auto: timer</option><option value="manual">Auto: off</option></select></div>
            <div class="src"><span data-el="source"></span><select data-el="sources" aria-label="Which video to snapshot" hidden></select><button class="link" data-act="app">All captures</button></div>
          </footer>
        </section>`;
      feed = sh.querySelector('[data-el="feed"]');
      for (const el of sh.querySelectorAll('[data-el]')) els[el.dataset.el] = el;
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act;
        if (act === 'close') setOpen(false);
        else if (act === 'snapshot') { on.snapshot(); flash(b); }
        else if (act === 'cc') on.enableCaptions();
        else if (act === 'app') on.openApp();
        else if (act === 'share') on.captureShare();
      });
      els.mode.addEventListener('change', () => on.setMode(els.mode.value));
      els.sources.addEventListener('change', () => on.chooseSource(els.sources.value));
      feed.addEventListener('scroll', () => { follow = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48; });
      sh.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setOpen(false); if (button) button.focus(); } });
      doc.body.appendChild(host);
      placePanel();
    }

    function placePanel() {
      if (!sh) return;
      const panel = sh.querySelector('.panel');
      // Sit above Meet's bottom bar, whatever its height: the bar is where our button lives.
      const r = button && button.isConnected ? button.getBoundingClientRect() : null;
      const bottom = r && r.height ? Math.max(72, root.innerHeight - r.top + 16) : 96;
      panel.style.setProperty('--bottom', bottom + 'px');
    }

    function setOpen(next) {
      ensurePanel();
      open = !!next;
      const panel = sh.querySelector('.panel');
      panel.classList.toggle('open', open);
      panel.setAttribute('aria-hidden', String(!open));
      if (button) button.setAttribute('aria-pressed', String(open));
      if (open) { placePanel(); follow = true; feed.scrollTop = feed.scrollHeight; }
      try { sessionStorage.setItem('meet-capture-panel-open', open ? '1' : '0'); } catch (e) { /* fine */ }
      if (on.toggled) on.toggled(open);
    }
    const wasOpen = () => { try { return sessionStorage.getItem('meet-capture-panel-open'); } catch (e) { return null; } };

    // ---------------------------------------------------------------- the button in Meet's bar
    const RIGHT_GROUP = [/chat with everyone|^chat$|in-call messages/i, /show everyone|^people$|participants/i, /activities/i, /meeting details/i];
    function findAnchor() {
      const buttons = [...doc.querySelectorAll('button[aria-label], [role="button"][aria-label]')].filter((b) => !b.closest('[role="dialog"], [role="menu"], #meet-capture-panel'));
      for (const re of RIGHT_GROUP) { const b = buttons.find((x) => re.test(x.getAttribute('aria-label') || '')); if (b) return b; }
      return null;
    }
    /** The element to insert ours after: the child of the button group that holds the anchor button. */
    function wrapperOf(btn) {
      let el = btn;
      for (let i = 0; i < 6 && el.parentElement; i++) {
        const p = el.parentElement;
        const n = [...p.children].filter((c) => c.matches('button, [role="button"]') || c.querySelector('button, [role="button"]')).length;
        if (n >= 2) return el;
        el = p;
      }
      return btn;
    }
    function ensureButton() {
      if (button && button.isConnected) return true;
      const anchor = findAnchor();
      if (!anchor) return false;
      const wrapper = wrapperOf(anchor);
      if (!button) {
        const hostEl = doc.createElement('div'); hostEl.id = 'meet-capture-button';
        bsh = hostEl.attachShadow({ mode: 'open' });
        bsh.innerHTML = `<style>${BUTTON_CSS}</style><span class="wrap"><button type="button" aria-label="Meet Capture" aria-pressed="false">${ICON}<span class="badge"></span></button><span class="tip">Meet Capture</span></span>`;
        button = bsh.querySelector('button');
        button.addEventListener('click', () => setOpen(!open));
        button.host = hostEl;
      }
      // Match the size and shape of Meet's own buttons so ours looks native.
      try {
        const cs = root.getComputedStyle(anchor);
        const w = parseFloat(cs.width), h = parseFloat(cs.height);
        if (w >= 32 && w <= 64) button.style.width = cs.width;
        if (h >= 32 && h <= 64) button.style.height = cs.height;
        if (cs.borderRadius) button.style.borderRadius = cs.borderRadius;
        if (cs.color) button.style.color = cs.color;
        const ws = root.getComputedStyle(wrapper);
        button.host.style.margin = ws.margin;
        const r = anchor.getBoundingClientRect();
        if (r.width) button.host.style.verticalAlign = 'top';
      } catch (e) { /* defaults */ }
      wrapper.insertAdjacentElement('afterend', button.host);
      placePanel();
      return true;
    }

    // ---------------------------------------------------------------- the feed
    function lineEl(l) {
      const el = doc.createElement('div'); el.className = 'msg';
      el.innerHTML = `<div class="av"></div><div class="body"><div class="who"><span class="name"></span><span class="time"></span></div><div class="text"></div></div>`;
      return el;
    }
    function renderLine(el, l, cont) {
      const av = el.querySelector('.av'), name = el.querySelector('.name'), time = el.querySelector('.time'), text = el.querySelector('.text');
      el.classList.toggle('cont', !!cont);
      if (av.dataset.for !== l.speaker) {
        av.dataset.for = l.speaker; av.style.background = colorFor(l.speaker);
        av.innerHTML = l.avatar ? `<img src="${esc(l.avatar)}" alt="">` : esc(initials(l.speaker));
      }
      if (name.textContent !== l.speaker) name.textContent = l.speaker;
      const t = NS.fmtClock(l.startedAt); if (time.textContent !== t) time.textContent = t;
      if (text.textContent !== l.text) text.textContent = l.text;
      text.classList.toggle('live', !l.final);
    }
    function snapEl(s) {
      const el = doc.createElement('div'); el.className = 'snap';
      el.innerHTML = `<img alt="Snapshot ${s.n}"><div class="cap"><b>Snapshot ${s.n}</b><span>${esc(NS.fmtTime(s.takenAt))} · ${esc(s.reason)}</span></div>`;
      el.querySelector('img').src = s.thumb;
      return el;
    }
    function renderFeed(st) {
      const events = [];
      for (const l of st.lines) events.push({ k: 'l:' + l.id, at: l.startedAt, l });
      for (const s of st.snapshots) events.push({ k: 's:' + s.takenAt, at: s.takenAt, s });
      // Lines keep their place once shown (a growing line must not jump); only new events are placed by time.
      let prevSpeaker = '', appended = false, lastKey = '';
      const order = [];
      for (const ev of events) { const known = feedKeys.get(ev.k); order.push({ ev, el: known ? known.el : null, pos: known ? known.pos : ev.at }); }
      order.sort((a, b) => a.pos - b.pos);
      const keep = new Set();
      let prev = null;
      for (const o of order) {
        keep.add(o.ev.k);
        let el = o.el;
        if (!el) {
          el = o.ev.l ? lineEl(o.ev.l) : snapEl(o.ev.s);
          feedKeys.set(o.ev.k, { el, pos: o.pos });
          if (prev) prev.insertAdjacentElement('afterend', el); else feed.appendChild(el);
          appended = true;
        } else if (prev && prev.nextElementSibling !== el) prev.insertAdjacentElement('afterend', el);
        if (o.ev.l) { renderLine(el, o.ev.l, prev && prev.classList.contains('msg') && prevSpeaker === o.ev.l.speaker); prevSpeaker = o.ev.l.speaker; }
        else prevSpeaker = '';
        prev = el;
      }
      for (const [k, v] of feedKeys) if (!keep.has(k)) { v.el.remove(); feedKeys.delete(k); }
      els.empty.hidden = events.length > 0;
      if (!events.length) {
        els.empty.innerHTML = st.captionsOn === false
          ? '<b>Captions are off</b>Turn them on in Meet (the CC button) and every line lands here with the speaker and the time.'
          : st.regionFound ? '<b>Listening</b>Lines appear here as people speak.' : '<b>Waiting for captions</b>Meet starts them in a moment. Lines appear here as people speak.';
        if (!els.empty.isConnected) feed.appendChild(els.empty);
      }
      if ((appended || open) && follow) feed.scrollTop = feed.scrollHeight;
    }

    function update(st) {
      Object.assign(lastState, st);
      if (!st.inCall) { destroyPanel(); return; }
      ensureButton();
      ensurePanel();
      placePanel();
      if (!st.ready) return;
      if (st.firstUpdate && (wasOpen() === '1' || (wasOpen() === null && st.openByDefault))) setOpen(true);
      const bits = [`${st.lineCount} line${st.lineCount === 1 ? '' : 's'}`, `${st.snapshotCount} snapshot${st.snapshotCount === 1 ? '' : 's'}`];
      els.status.textContent = `${st.regionFound ? 'Capturing' : st.captionsOn === false ? 'Captions off' : 'Waiting for captions'} · ${NS.fmtElapsed(st.elapsed)} · ${bits.join(' · ')}`;
      sh.querySelector('.dot').classList.toggle('idle', !st.regionFound);
      sh.querySelector('[data-act="cc"]').hidden = !(st.captionsOn === false && !st.regionFound);
      if (els.mode.value !== st.mode) els.mode.value = st.mode;
      // Source line and picker
      const src = st.source;
      const cands = st.candidates || [];
      if (cands.length > 1) {
        const autoLabel = `Auto · ${src && st.chosenSource === 'auto' ? (src.label || 'the shared screen') : 'the shared screen'}`;
        const want = ['auto:' + autoLabel, ...cands.map((c) => c.id)].join('|');
        if (els.sources.dataset.ids !== want) {
          els.sources.dataset.ids = want;
          els.sources.innerHTML = `<option value="auto">${esc(autoLabel)}</option>` + cands.map((c) => `<option value="${esc(c.id)}">${esc(c.label || (c.presenting ? 'Presentation' : 'Video'))}${c.self ? ' (you)' : ''} · ${c.width}×${c.height}</option>`).join('');
        }
        if (els.sources.value !== st.chosenSource) els.sources.value = st.chosenSource;
        els.sources.hidden = false;
        els.source.textContent = 'Snapshots of';
      } else {
        els.sources.hidden = true;
        els.source.textContent = src ? `Snapshots of ${src.label || 'the shared screen'}` : st.selfPresenting ? '' : 'No shared screen yet';
      }
      if (st.shareActive) els.source.textContent = 'Snapshots of your screen share';
      const badge = bsh && bsh.querySelector('.badge'); if (badge) badge.classList.toggle('on', !!st.regionFound);
      // Presenting yourself: Meet shows no preview of your own share.
      const c = els.callout;
      if (st.selfPresenting && !st.shareActive) {
        if (c.dataset.kind !== 'share') { c.dataset.kind = 'share'; c.className = 'callout'; c.innerHTML = `You're presenting. Meet's own preview of your share stops updating once you switch to another window, so pick your share here once and snapshots of it continue by themselves, whatever is on your screen.<br><button class="btn" data-act="share">${CAMERA}Capture my share</button>`; }
        c.hidden = false;
      } else if (st.shareActive) {
        if (c.dataset.kind !== 'sharing') { c.dataset.kind = 'sharing'; c.className = 'callout ok'; c.textContent = 'Capturing your screen share: snapshots are taken as it changes, even while this tab is in the background. Alt+Shift+S takes one from any app.'; }
        c.hidden = false;
      } else { c.hidden = true; c.dataset.kind = ''; }
      renderFeed(st);
    }

    function flash(b) {
      b = b || (sh && sh.querySelector('[data-act="snapshot"]'));
      if (!b) return;
      b.classList.add('flash');
      setTimeout(() => b.classList.remove('flash'), 500);
    }

    function destroyPanel() {
      if (host) { host.remove(); }
      if (button && button.host) button.host.remove();
      host = null; sh = null; feed = null; els = {}; button = null; bsh = null; open = false; feedKeys = new Map();
    }

    // ---------------------------------------------------------------- the card after the call
    function showAfterCall(info, actions) {
      hideAfterCall();
      card = doc.createElement('div'); card.id = 'meet-capture-after';
      const s = card.attachShadow({ mode: 'open' });
      const sub = info.captured ? `${info.lineCount} line${info.lineCount === 1 ? '' : 's'} · ${info.snapshotCount} snapshot${info.snapshotCount === 1 ? '' : 's'} · ${NS.fmtDuration(info.duration)}` : 'No captions or snapshots were captured in this call.';
      s.innerHTML = `<style>${CARD_CSS}</style><div class="card" role="status"><div class="ok"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg></div>
        <div><div class="t">${info.captured ? 'Meeting captured' : 'Meet Capture'}</div><div class="s">${esc(sub)}</div></div>
        ${info.captured ? `<button class="btn" data-act="open">Open transcript</button><button class="btn ghost" data-act="claude">Open in Claude</button>` : ''}
        <button class="x" data-act="x" aria-label="Dismiss">${CLOSE}</button></div>`;
      s.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'open') actions.openApp();
        else if (b.dataset.act === 'claude') actions.openClaude();
        hideAfterCall();
      });
      doc.body.appendChild(card);
      setTimeout(hideAfterCall, 90000);
    }
    function hideAfterCall() { if (card) { card.remove(); card = null; } }

    root.addEventListener('resize', placePanel);
    return { update, setOpen, isOpen: () => open, flash, showAfterCall, hideAfterCall, destroy: () => { destroyPanel(); hideAfterCall(); } };
  }

  Object.assign(NS, { createMeetUI, colorFor, initials });
})(typeof globalThis !== 'undefined' ? globalThis : this);
