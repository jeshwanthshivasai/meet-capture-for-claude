// Snapshots of the shared screen: finding the right <video>, deciding when the picture has changed,
// and turning a frame into an image. The decision logic (createChangeDetector) is pure and tested in Node.
(function (root) {
  const NS = (root.MCC = root.MCC || {});
  const normalize = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const SIG_W = 48, SIG_H = 27;

  /** A tiny grayscale copy of a frame, used only to compare frames. */
  function signatureOf(source, canvas) {
    canvas.width = SIG_W; canvas.height = SIG_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, SIG_W, SIG_H);
    const d = ctx.getImageData(0, 0, SIG_W, SIG_H).data;
    const out = new Uint8Array(SIG_W * SIG_H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    return out;
  }

  /** 0 = identical, 1 = every pixel as different as can be. */
  function difference(a, b) {
    if (!a || !b || a.length !== b.length) return 1;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / (a.length * 255);
  }

  /** One flat colour: a black frame, a stream that has not started, a blank slide. */
  function isBlank(sig) {
    let min = 255, max = 0;
    for (let i = 0; i < sig.length; i++) { const v = sig[i]; if (v < min) min = v; if (v > max) max = v; }
    return max - min < 8;
  }

  /**
   * Decides when an automatic snapshot is due. Feed it one signature about every second.
   * A new picture is captured the moment it appears (so a screen shown only briefly is still kept),
   * and once more when it has settled if it ended up different from that first look. Pictures seen
   * recently are not captured again, a new source is, and a timer can add regular ones. When frames
   * keep changing for a long time (a video, constant scrolling) it slows down to one every so often.
   */
  function createChangeDetector(o = {}) {
    let threshold = o.threshold ?? 0.035, settleMs = o.settleMs ?? 1200, minGapMs = o.minGapMs ?? 1200, timerMs = o.timerMs ?? 0;
    let quickEveryMs = o.quickEveryMs ?? 2500, dupeWindowMs = o.dupeWindowMs ?? 90000, busyAfter = o.busyAfter ?? 20, busyEveryMs = o.busyEveryMs ?? 15000;
    const now = o.now || (() => Date.now());
    let lastSaved = null, lastSavedAt = 0, lastSig = null, pendingSince = 0, lastQuickAt = 0, lastSource = null, pendingSource = false;
    const recent = [];     // the last saved signatures, so the same picture is not kept twice
    const savedAt = [];    // times of recent saves, to notice a busy picture
    const seenLately = (sig, t) => recent.some((r) => t - r.t <= dupeWindowMs && difference(sig, r.sig) < threshold / 2);
    return {
      configure(c) {
        if (c.threshold != null) threshold = c.threshold;
        if (c.timerMs != null) timerMs = c.timerMs;
        if (c.minGapMs != null) minGapMs = c.minGapMs;
        if (c.settleMs != null) settleMs = c.settleMs;
        if (c.quickEveryMs != null) quickEveryMs = c.quickEveryMs;
        if (c.busyEveryMs != null) busyEveryMs = c.busyEveryMs;
      },
      saved(sig, t = now()) {
        lastSaved = sig; lastSavedAt = t; pendingSince = 0; pendingSource = false;
        recent.push({ sig, t }); if (recent.length > 16) recent.shift();
        savedAt.push(t); while (savedAt.length && t - savedAt[0] > 60000) savedAt.shift();
      },
      reset() { lastSaved = null; lastSavedAt = 0; lastSig = null; pendingSince = 0; lastQuickAt = 0; lastSource = null; pendingSource = false; recent.length = 0; savedAt.length = 0; },
      /** @returns a reason string when a snapshot should be taken now, else null */
      sample(sig, sourceId, t = now()) {
        const moved = lastSig ? difference(sig, lastSig) : 1;
        lastSig = sig;
        if (isBlank(sig)) { pendingSince = 0; return null; }
        if (lastSource !== null && sourceId !== lastSource) pendingSource = true;
        lastSource = sourceId;
        if (!lastSaved) return 'first frame';
        if (pendingSource && t - lastSavedAt >= minGapMs) { pendingSource = false; return 'new source'; }
        while (savedAt.length && t - savedAt[0] > 60000) savedAt.shift();
        const busy = savedAt.length >= busyAfter;
        const diff = difference(sig, lastSaved);
        if (diff >= threshold) {
          if (!pendingSince) pendingSince = t;
          const still = moved < threshold / 2, gap = t - lastSavedAt;
          if (!seenLately(sig, t)) {
            if (busy) { if (gap >= busyEveryMs) return 'screen changed'; }                                          // rationed while the picture keeps changing
            else if (gap >= minGapMs) {
              if (still && t - pendingSince >= settleMs) return 'screen changed';                                   // settled: the picture to keep
              if (!still && t - lastQuickAt >= quickEveryMs) { lastQuickAt = t; return 'screen changed'; }          // first look at a new picture
            }
          }
        } else pendingSince = 0;
        if (timerMs && t - lastSavedAt >= timerMs && diff > 0.002) return 'timer';
        return null;
      },
    };
  }

  // ------------------------------------------------------------------ DOM: which video is the shared screen?
  const ids = typeof WeakMap === 'function' ? new WeakMap() : null;
  let nextId = 1;
  const idOf = (v) => { let id = ids.get(v); if (!id) { id = 'v' + nextId++; ids.set(v, id); } return id; };
  const PRESENTING = /presenting|presentation|présent|präsent|presentaci|apresenta|presentazione|プレゼン|발표|screen share|is sharing|shared screen/i;

  function tileOf(v) {
    let el = v;
    for (let i = 0; i < 8 && el && el.parentElement; i++) {
      el = el.parentElement;
      if (el.hasAttribute('data-participant-id') || el.hasAttribute('data-requested-participant-id') || el.getAttribute('role') === 'listitem') return el;
    }
    return v.parentElement;
  }

  const MIRROR = /you are presenting|infinity mirror/i;           // Meet's note on its own preview of your share
  const ICON_WORD = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;                   // a Material Symbols ligature: open_in_full, more_vert, mic
  const UI_LINE = /^(enter|exit) full ?screen$|^(pin|unpin|mute|unmute|remove|more options|minimi[sz]e|maximi[sz]e)\b/i;
  const SELF_TAG = /\s*\((?:you|vous|du|tú|você|sie|tu)\b[^)]*\)/i;  // "(You)", "(You, presenting)"
  const NAME_LINE = /^\p{Lu}[\p{L}'’.-]*(?:\s+[\p{L}'’.-]+){0,4}$/u;

  /**
   * One short label for a tile, from the lines of text it shows: a participant's name when there is one,
   * else the first line that is not an icon's name, a control's label or Meet's own note, cut at a
   * sentence end and capped at 40 characters. "" when nothing fits.
   */
  function cleanLabel(lines) {
    const out = [];
    for (const raw of lines) {
      let s = normalize(raw).replace(SELF_TAG, '');
      if (!s || ICON_WORD.test(s) || UI_LINE.test(s) || MIRROR.test(s)) continue;
      s = s.split(/(?<=[.!?…])\s+/)[0];
      if (s) out.push(s);
    }
    const pick = out.find((s) => s.length <= 40 && NAME_LINE.test(s)) || out[0] || '';
    return pick.length <= 40 ? pick : pick.slice(0, 40).replace(/\s+\S*$/, '') + '…';
  }
  const linesOf = (tile) => String((tile && (tile.innerText != null ? tile.innerText : tile.textContent)) || '').split(/\n+/);

  function labelOf(tile) {
    if (!tile) return '';
    const self = tile.querySelector('[data-self-name]');
    if (self) return cleanLabel([self.getAttribute('data-self-name') || self.textContent]);
    const aria = tile.getAttribute('aria-label');
    if (aria) { const l = cleanLabel([aria]); if (l) return l; }
    return cleanLabel(linesOf(tile));
  }

  /** Visible, playing videos on the page, best guess for the shared screen first. */
  function candidates(doc, win) {
    const out = [];
    for (const v of doc.querySelectorAll('video')) {
      if (!v.videoWidth || v.readyState < 2 || v.ended) continue;
      const r = v.getBoundingClientRect();
      if (r.width < 40 || r.height < 40 || r.bottom < 0 || r.right < 0 || r.top > win.innerHeight || r.left > win.innerWidth) continue;
      const style = win.getComputedStyle(v);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      const tile = tileOf(v);
      const text = normalize(((tile && tile.innerText) || '') + ' ' + ((tile && tile.getAttribute('aria-label')) || '') + ' ' + [...((tile && tile.querySelectorAll('[aria-label]')) || [])].map((b) => b.getAttribute('aria-label')).join(' '));
      const mirror = MIRROR.test(text); // Meet's own preview of your share: Meet inside Meet, frozen while this tab is in the background
      const label = mirror ? "Meet's preview of your share" : labelOf(tile);
      const mirrored = /matrix\(-1|scaleX\(-1\)|scale\(-1/.test(style.transform || '');
      const presenting = mirror || PRESENTING.test(text);
      const self = !presenting && (mirrored || /^you$/i.test(label) || SELF_TAG.test(text));
      out.push({ video: v, id: idOf(v), width: v.videoWidth, height: v.videoHeight, area: Math.round(r.width * r.height), label, presenting, self, mirror, mirrored, likely: presenting });
    }
    // A share Meet does not label: the biggest picture on screen, at a resolution no webcam tile gets.
    const maxArea = out.reduce((m, c) => Math.max(m, c.area), 0);
    for (const c of out) if (!c.self && !c.mirrored && (c.width >= 1400 || (c.width >= 960 && c.area === maxArea))) c.likely = true;
    out.sort((a, b) => (b.presenting - a.presenting) || (Number(a.mirror) - Number(b.mirror)) || (b.likely - a.likely) || (a.self - b.self) || (b.area - a.area)); // a real share before Meet's mirror of yours
    return out;
  }

  /** A full-size image of one frame plus a small preview, as data URLs. The source is a <video> or an ImageBitmap. */
  function capture(video, { maxWidth = 1600, format = 'png', quality = 0.9, doc } = {}) {
    const w0 = video.videoWidth || video.width, h0 = video.videoHeight || video.height;
    const scale = Math.min(1, maxWidth / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const c = doc.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(video, 0, 0, w, h);
    const dataUrl = c.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png', quality);
    const tw = Math.min(240, w), th = Math.max(1, Math.round(h * tw / w));
    const t = doc.createElement('canvas'); t.width = tw; t.height = th;
    t.getContext('2d').drawImage(c, 0, 0, tw, th);
    return { dataUrl, thumb: t.toDataURL('image/jpeg', 0.7), width: w, height: h, format };
  }

  Object.assign(NS, { signatureOf, difference, isBlank, createChangeDetector, candidates, cleanLabel, capture, MIRROR, SIG_W, SIG_H });
})(typeof globalThis !== 'undefined' ? globalThis : this);
