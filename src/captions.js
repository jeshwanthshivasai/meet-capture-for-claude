// Reading the captions Google Meet draws on the page, and rebuilding whole utterances from them.
//
// Meet shows a rolling window per speaker: the text grows as the person talks, the last words get revised
// as recognition settles, and once the block is long the start scrolls out of view. stitch() turns those
// windows back into one continuous text. Nothing here touches chrome.* and the DOM helpers only use
// querySelector/children/textContent, so the same file runs as a content script and in Node for tests.
(function (root) {
  const NS = (root.MCC = root.MCC || {});
  const normalize = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // Words Meet uses in the aria-label of the captions region, per language. Add a language here only.
  const CAPTION_LABEL_WORDS = ['caption', 'subtitle', 'untertitel', 'sous-titre', 'sottotitoli', 'subtítulo', 'subtitulo', 'legenda', 'ondertiteling', 'napisy', 'субтитры', '字幕', '자막'];
  const REGION_SELECTOR = CAPTION_LABEL_WORDS.map((w) => `[role="region"][aria-label*="${w}" i]`).join(', ');
  const LABELLED_SELECTOR = CAPTION_LABEL_WORDS.map((w) => `[aria-label*="${w}" i]`).join(', ');
  // Containers seen around the captions region in 2025–2026 builds of Meet, most recent first.
  const KNOWN_CONTAINERS = ['[jsname="dsyhDe"]', '[jsname="tgaKEf"]', '[jsname="DS9Ooe"]'];
  // One block per speaker turn, with the speaker's name and the caption text inside it.
  const ITEM_SELECTOR = '.nMcdL, [jsname="YSxPC"]';
  const SPEAKER_SELECTOR = '.NWpY1d, [jsname="r4nke"]';
  const TEXT_SELECTOR = '.ygicle, [jsname="bVV8Bd"]';
  const AVATAR_SELECTOR = 'img[data-iml], img[src*="googleusercontent.com"]';

  const inDialog = (el) => !!(el && el.closest && el.closest('[role="dialog"], [role="alertdialog"]'));
  const textKids = (block) => [...(block && block.children ? block.children : [])].filter((k) => normalize(k.textContent).length > 0);

  /** Does this element plausibly hold caption blocks (name + text), rather than a status announcement? */
  function looksLikeCaptions(el) {
    if (!el || !el.children) return false;
    if (el.closest && el.closest(LABELLED_SELECTOR)) return true;
    for (const block of el.children) {
      if (!block.children) continue;
      const kids = textKids(block);
      if (kids.length < 2) continue;
      if ((block.matches && block.matches(ITEM_SELECTOR)) || (block.querySelector && block.querySelector(AVATAR_SELECTOR))) return true;
      if (normalize(kids[0].textContent).length <= 60) return true;
    }
    return false;
  }

  /** The captions region, found by label first, then by known containers, then by structure. */
  function findRegion(doc) {
    for (const el of doc.querySelectorAll(REGION_SELECTOR)) if (!inDialog(el)) return { region: el, strategy: 'label' };
    for (const sel of KNOWN_CONTAINERS) {
      const c = doc.querySelector(sel);
      if (c && !inDialog(c)) return { region: c.querySelector('[role="region"]') || c, strategy: 'container ' + sel };
    }
    const lives = [...doc.querySelectorAll('[aria-live], [role="region"][tabindex="0"]')].filter((el) => !inDialog(el) && looksLikeCaptions(el));
    if (lives.length) {
      lives.sort((a, b) => b.children.length - a.children.length);
      return { region: lives[0], strategy: 'structure' };
    }
    return null;
  }

  function isItem(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches && node.matches(ITEM_SELECTOR)) return true;
    return !!(node.querySelector && node.querySelector(AVATAR_SELECTOR)) && textKids(node).length >= 2;
  }

  /** The speaker blocks inside the region, in display order. */
  function items(region) {
    const known = [...region.querySelectorAll(ITEM_SELECTOR)];
    if (known.length) return known;
    return [...region.children].filter((el) => el.nodeType === 1 && textKids(el).length >= 2);
  }

  /** { speaker, text } for one block, or null when it has no caption text yet. */
  function readItem(el) {
    let speakerEl = el.querySelector(SPEAKER_SELECTOR);
    let textEl = el.querySelector(TEXT_SELECTOR);
    if (!speakerEl || !textEl) {
      const kids = textKids(el);
      if (kids.length < 2) return null;
      if (!speakerEl) speakerEl = el.querySelector('span') || kids[0];
      if (!textEl) {
        const rest = kids.filter((k) => k !== speakerEl && !(k.contains && k.contains(speakerEl)) && !(k.querySelector && k.querySelector(AVATAR_SELECTOR)));
        textEl = rest[rest.length - 1] || kids[kids.length - 1];
      }
    }
    if (!speakerEl || !textEl || speakerEl === textEl) return null;
    const speaker = normalize(speakerEl.textContent), text = normalize(textEl.textContent);
    if (!speaker || !text || speaker.length > 80) return null;
    return { speaker, text };
  }

  // ------------------------------------------------------------------ stitching windows into one text
  const MIN_ALIGN = 8; // characters two texts must share before we trust the alignment

  function commonPrefix(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
  }

  /**
   * full: everything we have for this block so far; win: the window of it Meet showed last time
   * (always the tail of full); next: what Meet shows now. Returns the new { full, win, how }.
   */
  function stitch(full, win, next) {
    full = full || ''; win = win || ''; next = normalize(next);
    if (!next) return { full, win, how: 'ignored' };
    if (!win) return { full: full ? full + ' ' + next : next, win: next, how: 'start' };
    if (next === win) return { full, win, how: 'same' };
    const head = full.slice(0, full.length - win.length);
    // Where in the old window does the new one begin? Only word boundaries are candidates.
    let best = { j: -1, len: 0 };
    for (let j = 0; j < win.length; j++) {
      if (j > 0 && win.charCodeAt(j - 1) !== 32) continue;
      const len = commonPrefix(win.slice(j), next);
      if (len > best.len) best = { j, len };
    }
    const rest = best.j >= 0 ? win.length - best.j : 0;
    const aligned = best.len > 0 && (best.len >= MIN_ALIGN || best.len >= rest || best.len >= next.length);
    if (aligned) return { full: head + win.slice(0, best.j) + next, win: next, how: best.j === 0 ? 'revise' : 'scroll' };
    // No overlap at all: Meet started this block over. Keep what we had and continue after it.
    return { full: full + ' ' + next, win: next, how: 'append' };
  }

  // ------------------------------------------------------------------ the transcript being built
  /**
   * Entries keyed by the caption block that produced them. When Meet re-renders its region the same
   * words come back in new blocks; bind() recognises them so they continue the entry instead of
   * duplicating it.
   */
  function createTranscript(opts = {}) {
    const now = opts.now || (() => Date.now());
    const REBIND_MS = opts.rebindMs || 90000;
    const entries = [];
    const byKey = new Map();
    let seq = 0;

    function bind(key, speaker, text) {
      let e = byKey.get(key);
      if (e) return e;
      const t = now();
      for (let i = entries.length - 1; i >= 0; i--) {
        const c = entries[i];
        if (t - c.updatedAt > REBIND_MS) break;
        if (c.speaker !== speaker) continue;
        const strong = c.full === text || c.full.endsWith(text) || (c.win && text.startsWith(c.win));
        const recent = t - c.updatedAt < 8000;
        if ((strong && (text.length >= 12 || recent)) || (recent && !c.final && c.full.includes(text))) {
          if (c.key != null) byKey.delete(c.key);
          c.key = key; c.final = false;
          byKey.set(key, c);
          return c;
        }
      }
      e = { id: ++seq, key, speaker, full: '', win: '', startedAt: t, updatedAt: t, final: false };
      entries.push(e);
      byKey.set(key, e);
      return e;
    }

    function upsert(key, speaker, text) {
      const e = bind(key, speaker, text);
      const r = stitch(e.full, e.win, text);
      const changed = r.full !== e.full;
      e.full = r.full; e.win = r.win;
      if (changed) e.updatedAt = now();
      return { entry: e, changed, how: r.how };
    }

    /** The block for this key left the page: the entry is complete (until Meet shows it again). */
    function release(key) {
      const e = byKey.get(key);
      if (!e) return null;
      byKey.delete(key);
      e.key = null; e.final = true;
      return e;
    }

    return { bind, upsert, release, all: () => entries, boundKeys: () => [...byKey.keys()] };
  }

  Object.assign(NS, { CAPTION_LABEL_WORDS, REGION_SELECTOR, ITEM_SELECTOR, findRegion, looksLikeCaptions, isItem, items, readItem, stitch, commonPrefix, createTranscript });
})(typeof globalThis !== 'undefined' ? globalThis : this);
