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
  // Alignment is done on words, ignoring case and punctuation: recognition keeps changing "Hi!" into
  // "Hi, how?" into "Hi, how are you?", and the characters differ long before the words do.
  const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  function words(s) {
    const out = [];
    for (const m of String(s).matchAll(WORD_RE)) out.push({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
    return out;
  }

  function commonPrefix(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
  }

  /**
   * full: everything we have for this block so far; win: the window of it Meet showed last time
   * (always the tail of full); next: what Meet shows now. Returns the new { full, win, how, added }:
   * how is 'grow' (words were added), 'revise' (the tail was rewritten), 'scroll' (the start of the
   * window left the screen), 'append' (nothing in common: the block started over), 'start', 'same' or
   * 'ignored'; added is the text that is new at the end, when there is some.
   */
  function stitch(full, win, next) {
    full = full || ''; win = win || ''; next = normalize(next);
    if (!next) return { full, win, how: 'ignored', added: '' };
    if (!win) return { full: full ? full + ' ' + next : next, win: next, how: 'start', added: next };
    if (next === win) return { full, win, how: 'same', added: '' };
    const head = full.slice(0, full.length - win.length);
    const W = words(win), N = words(next);
    if (!N.length) return { full, win, how: 'ignored', added: '' };
    if (!W.length) return { full: head + next, win: next, how: 'revise', added: '' };
    // The new window starts at word j of the old one and k words match from there.
    let best = null;
    for (let j = 0; j < W.length; j++) {
      let k = 0;
      while (j + k < W.length && k < N.length && W[j + k].w === N[k].w) k++;
      if (!k) continue;
      const left = W.length - (j + k); // old words after the match that the new window no longer shows
      const ok = j === 0
        ? left <= Math.max(2, Math.floor(W.length / 2))   // same start: the tail was revised, or words were added
        : left <= 2 && (k >= 2 || k === N.length);         // the start scrolled away: the overlap must reach the end
      if (!ok) continue;
      const score = k * 2 - left - (j > 0 ? 1 : 0);
      if (!best || score > best.score) best = { j, k, left, score };
    }
    if (!best) {
      // A block that was one word and is now something else was recognition's first guess ("I." → "So"): replace it.
      if (W.length === 1 && full === win) return { full: next, win: next, how: 'revise', added: '' };
      return { full: full + ' ' + next, win: next, how: 'append', added: next };
    }
    const keep = best.j === 0 ? '' : win.slice(0, W[best.j].start);
    const tailIsNew = best.left === 0 && N.length > best.k;
    const how = best.j > 0 ? 'scroll' : tailIsNew ? 'grow' : 'revise';
    const added = tailIsNew ? next.slice(N[best.k - 1].end).trim() : '';
    return { full: head + keep + next, win: next, how, added };
  }

  // ------------------------------------------------------------------ the transcript being built
  const SPLIT_PAUSE_MS = 4000;  // no new words for this long: the next words start a new line
  const SPLIT_LONG_MS = 40000;  // a line this old is cut at its last sentence end; past 1.5× at a clause break; past ~1.9× at any word
  const CUT_SENTENCE = /[.!?…]["'”’)\]]?\s+/g;
  const CUT_CLAUSE = /[,;:]\s+/g;
  const CUT_WORD = /\s+/g;
  const TAIL_GUARD = 12;        // characters at the end of a block that recognition is still rewriting: never cut there
  const MIN_HEAD = 0.4;         // a cut must leave at least this share of the text in front of it: no one-word lines

  /**
   * Where to cut a segment that has run past the limit: at its last sentence end (the whole text is searched,
   * so a full stop that Meet adds by a later revision counts), else past 1.5× the limit at its last clause
   * break, else past ~1.9× at any word boundary. Returns the offset in text, or 0 for none.
   */
  function cutPoint(text, ageMs, longMs) {
    const rules = [[longMs, CUT_SENTENCE], [longMs * 1.5, CUT_CLAUSE], [longMs * 1.875, CUT_WORD]];
    const limit = text.length - TAIL_GUARD, minHead = text.length * MIN_HEAD;
    for (const [after, re] of rules) {
      if (ageMs < after) break;
      let at = 0;
      re.lastIndex = 0;
      for (let m; (m = re.exec(text));) { const end = m.index + m[0].length; if (end > limit) break; if (end >= minHead) at = end; }
      if (at > 0) return at;
    }
    return 0;
  }

  /**
   * Entries keyed by the caption block that produced them. When Meet re-renders its region the same
   * words come back in new blocks; bind() recognises them so they continue the entry instead of
   * duplicating it. One block can run for minutes when one person keeps talking, so each entry is cut
   * into segments at pauses and, for long runs, at sentence ends; lines() gives one line per segment.
   */
  function createTranscript(opts = {}) {
    const now = opts.now || (() => Date.now());
    const REBIND_MS = opts.rebindMs || 90000;
    const pauseMs = opts.pauseMs || SPLIT_PAUSE_MS, longMs = opts.longMs || SPLIT_LONG_MS;
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
      e = { id: ++seq, key, speaker, full: '', win: '', startedAt: t, updatedAt: t, final: false, segs: [{ at: 0, startedAt: t, updatedAt: t }] };
      entries.push(e);
      byKey.set(key, e);
      return e;
    }

    /** Move a cut forward to the next word boundary, so a revision before it can't leave it mid-word. */
    function snap(full, at) {
      if (at <= 0 || at >= full.length || full.charCodeAt(at - 1) === 32) return at;
      const sp = full.indexOf(' ', at);
      return sp < 0 ? full.length : sp + 1;
    }

    /**
     * A revision before a cut changes the length of the text in front of it. Each cut remembers the
     * first words of its segment and is put back in front of them; if those words were rewritten too,
     * it stays where it was, moved to a word boundary.
     */
    function relocate(e) {
      if (e.segs.length < 2) return;
      const ws = words(e.full);
      for (let i = 1; i < e.segs.length; i++) {
        const s = e.segs[i];
        let at = -1, bestD = Infinity;
        for (let w = 0; s.anchor && w + s.anchor.length <= ws.length; w++) {
          let ok = true;
          for (let a = 0; a < s.anchor.length && ok; a++) ok = ws[w + a].w === s.anchor[a];
          if (!ok) continue;
          const d = Math.abs(ws[w].start - s.at);
          if (d < bestD) { bestD = d; at = ws[w].start; }
        }
        s.at = Math.max(e.segs[i - 1].at, at >= 0 ? at : snap(e.full, s.at));
      }
    }

    /**
     * A line that has run past the limit is cut where cutPoint says, anywhere in its text: Meet adds the
     * punctuation by later revision, so waiting for the text to end in a full stop could wait a minute
     * (a real call gave one sixty-second line). The new segment is placed in time by its position in the text.
     */
    function cutLongRun(e, t) {
      const last = e.segs[e.segs.length - 1];
      const age = t - last.startedAt;
      if (age < longMs) return;
      const text = e.full.slice(last.at);
      const at = cutPoint(text, age, longMs);
      if (!at) return;
      const abs = last.at + at;
      const startedAt = Math.min(t, last.startedAt + Math.round(age * at / Math.max(1, text.length)));
      last.updatedAt = Math.max(last.startedAt, startedAt);
      e.segs.push({ at: abs, startedAt, updatedAt: t, split: true, anchor: words(e.full.slice(abs)).slice(0, 3).map((x) => x.w) });
    }

    function upsert(key, speaker, text) {
      const e = bind(key, speaker, text);
      const t = now();
      const r = stitch(e.full, e.win, text);
      const changed = r.full !== e.full;
      if (changed) {
        // New words after a pause start a new line.
        if (r.added && e.full && t - e.updatedAt >= pauseMs) e.segs.push({ at: r.full.length - r.added.length, startedAt: t, updatedAt: t, split: true, anchor: words(r.added).slice(0, 3).map((x) => x.w) });
        e.full = r.full; e.win = r.win; e.updatedAt = t;
        relocate(e);
        cutLongRun(e, t);
        e.segs[e.segs.length - 1].updatedAt = t;
      }
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

    /** One line per segment of an entry: { id, speaker, text, startedAt, updatedAt, final, split }. */
    function lines(e) {
      const out = [];
      for (let i = 0; i < e.segs.length; i++) {
        const s = e.segs[i], end = i + 1 < e.segs.length ? e.segs[i + 1].at : e.full.length;
        const text = e.full.slice(s.at, end).trim();
        if (!text) continue;
        out.push({ id: i ? `${e.id}.${i}` : String(e.id), speaker: e.speaker, text, startedAt: s.startedAt, updatedAt: s.updatedAt, final: e.final, split: !!s.split });
      }
      return out;
    }

    return { bind, upsert, release, lines, all: () => entries, allLines: () => entries.flatMap(lines), boundKeys: () => [...byKey.keys()] };
  }

  Object.assign(NS, { CAPTION_LABEL_WORDS, REGION_SELECTOR, ITEM_SELECTOR, findRegion, looksLikeCaptions, isItem, items, readItem, stitch, words, commonPrefix, cutPoint, createTranscript });
})(typeof globalThis !== 'undefined' ? globalThis : this);
