// Turns a captured meeting into files: a Markdown transcript written for Claude, the snapshots, and
// optionally the raw JSON. Pure functions; the offscreen page and the service worker both use them.
(function (root) {
  const NS = (root.MCC = root.MCC || {});

  function participants(meeting, lines) {
    const names = [];
    for (const l of lines) if (l.speaker && !names.includes(l.speaker)) names.push(l.speaker);
    return names;
  }

  /** The name that replaces Meet's "You": the setting first, else the name read from the self tile. */
  function selfName(meeting, settings) { return (settings && settings.myName) || (meeting && meeting.myName) || ''; }
  /** Lines with "You" renamed. Captured lines keep the speaker as Meet showed it, so a later rename applies everywhere. */
  function withNames(lines, meeting, settings) {
    const me = selfName(meeting, settings);
    return me ? lines.map((l) => ({ ...l, speaker: NS.speakerAlias(l.speaker, me) })) : lines;
  }

  const byTime = (a, b) => (a.startedAt - b.startedAt) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });

  /** Lines in time order, merged where Meet split one person's words into back-to-back blocks a moment apart. */
  function tidyLines(lines) {
    const out = [];
    for (const l of [...lines].sort(byTime)) {
      const text = NS.normalize(l.text);
      if (!text) continue;
      const prev = out[out.length - 1];
      if (prev && prev.speaker === l.speaker) {
        if (prev.text === text || prev.text.endsWith(text)) continue;             // the same words again
        if (text.startsWith(prev.text)) { prev.text = text; prev.updatedAt = l.updatedAt; continue; } // a longer version
        if (!l.split && l.startedAt - prev.updatedAt < 2500) { prev.text += ' ' + text; prev.updatedAt = l.updatedAt; continue; }
      }
      out.push({ speaker: l.speaker, text, startedAt: l.startedAt, updatedAt: l.updatedAt });
    }
    return out;
  }

  /** The meeting's name for the top of the transcript; an unnamed call is shown by its code. */
  function titleOf(meeting) {
    const t = NS.normalize(meeting.title || '');
    if (t && t !== meeting.code) return t;
    return `Google Meet ${meeting.code || ''}`.trim();
  }

  function escapeMd(s) { return String(s).replace(/([\\`*_[\]<>#])/g, '\\$1'); }

  function buildMarkdown({ meeting, lines, snapshots, settings }) {
    const S = NS.settingsWithDefaults(settings);
    const tidy = tidyLines(withNames(lines, meeting, S));
    const names = participants(meeting, tidy);
    const start = meeting.startedAt, end = meeting.endedAt || meeting.exportedAt || Date.now();
    const files = snapshots.map((s, i) => ({ ...s, n: i + 1, file: NS.snapshotFile(i + 1, s.format) }));
    const out = [];
    out.push(`# ${escapeMd(titleOf(meeting))}`, '');
    const meta = [`Google Meet`, NS.fmtLongDate(start), `${NS.fmtClock(start)}–${NS.fmtClock(end)} (${NS.fmtDuration(end - start)})`];
    if (meeting.code) meta.push(`code ${meeting.code}`);
    out.push(meta.join(' · '));
    if (names.length) out.push(`Participants who spoke: ${names.map(escapeMd).join(', ')}`);
    out.push(`Captured on this computer by Meet Capture for Claude. The text is Meet's live captions, so names and words can be wrong. Times are local (${NS.utcOffset(start)}).`, '');
    if (S.preface && S.preface.trim()) out.push('## For Claude', '', S.preface.trim(), '');
    if (files.length) {
      out.push(`## Screen snapshots (${files.length})`, '', 'Attach these image files alongside this transcript.', '');
      for (const f of files) out.push(`${f.n}. ${NS.fmtTime(f.takenAt)} · ${f.file} · ${f.reason}${f.source ? ` · ${escapeMd(f.source)}` : ''}`);
      out.push('');
    }
    out.push('## Transcript', '');
    if (!tidy.length) out.push('_No captions were captured. Captions must be on in Meet (the CC button) for the transcript to fill._', '');
    let si = 0;
    const marker = (f) => `> 📷 Snapshot ${f.n} · ${NS.fmtTime(f.takenAt)} · ${f.file}`;
    for (const l of tidy) {
      while (si < files.length && files[si].takenAt <= l.startedAt) out.push(marker(files[si++]), '');
      out.push(`**[${NS.fmtTime(l.startedAt)}] ${escapeMd(l.speaker)}:** ${escapeMd(l.text)}`, '');
    }
    while (si < files.length) out.push(marker(files[si++]), '');
    return out.join('\n').trimEnd() + '\n';
  }

  function buildJson({ meeting, lines, snapshots, settings }) {
    const { tabId, ...m } = meeting;
    const me = selfName(meeting, NS.settingsWithDefaults(settings));
    return JSON.stringify({
      meeting: { ...m, myName: me },
      lines: [...lines].sort(byTime).map((l) => ({ id: String(l.id), speaker: me ? NS.speakerAlias(l.speaker, me) : l.speaker, text: l.text, startedAt: l.startedAt, updatedAt: l.updatedAt })),
      snapshots: snapshots.map((s, i) => ({ file: NS.snapshotFile(i + 1, s.format), takenAt: s.takenAt, reason: s.reason, source: s.source, width: s.width, height: s.height })),
      exportedAt: Date.now(),
      generator: 'Meet Capture for Claude',
    }, null, 2);
  }

  /** The files of an export: [{ name, data, mime }], data a string or Uint8Array. */
  function exportFiles({ meeting, lines, snapshots, settings }) {
    const S = NS.settingsWithDefaults(settings);
    const files = [{ name: 'transcript.md', data: buildMarkdown({ meeting, lines, snapshots, settings: S }), mime: 'text/markdown' }];
    snapshots.forEach((s, i) => { if (s.bytes) files.push({ name: NS.snapshotFile(i + 1, s.format), data: s.bytes instanceof Uint8Array ? s.bytes : new Uint8Array(s.bytes), mime: s.format === 'jpeg' ? 'image/jpeg' : 'image/png' }); });
    if (S.includeJson) files.push({ name: 'meeting.json', data: buildJson({ meeting, lines, snapshots, settings: S }), mime: 'application/json' });
    return files;
  }

  Object.assign(NS, { buildMarkdown, buildJson, exportFiles, tidyLines, participants, withNames, selfName, titleOf, byTime });
})(typeof globalThis !== 'undefined' ? globalThis : this);
