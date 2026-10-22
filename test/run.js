// Unit tests for the parts that need no browser: caption stitching, the transcript, the snapshot change
// detector, the export files and the ZIP writer. Run with: node test/run.js
'use strict';
const assert = require('assert');
const path = require('path');
for (const f of ['common', 'captions', 'snapshot', 'zip', 'export']) require(path.join(__dirname, '..', 'src', `${f}.js`));
const M = globalThis.MCC;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message || e).split('\n').join('\n      ')); }
}

// ------------------------------------------------------------------ stitch
const st = (full, win, next) => M.stitch(full, win, next);
test('stitch: first text starts the block', () => assert.deepStrictEqual(st('', '', 'Hello'), { full: 'Hello', win: 'Hello', how: 'start', added: 'Hello' }));
test('stitch: short revisions that differ only in punctuation replace the window (seen in a real call)', () => {
  let r = st('Hi!', 'Hi!', 'Hi, how?');
  assert.strictEqual(r.full, 'Hi, how?');
  r = st(r.full, r.win, 'Hi, how are you?');
  assert.deepStrictEqual([r.full, r.how, r.added], ['Hi, how are you?', 'grow', 'are you?']);
  r = st(r.full, r.win, 'Hi, how are you? So I have been looking');
  assert.strictEqual(r.full, 'Hi, how are you? So I have been looking');
});
test('stitch: a new window that only shares a first word with a long one is not a revision', () => {
  const r = st('I think we should start with the agenda for today', 'I think we should start with the agenda for today', 'I think so too');
  assert.strictEqual(r.how, 'append');
  assert.strictEqual(r.full, 'I think we should start with the agenda for today I think so too');
});
test('stitch: scroll overlap is matched on words, whatever the punctuation', () => {
  const r = st('we agreed on the rules. Next, the agenda', 'we agreed on the rules. Next, the agenda', 'Next the agenda for today');
  assert.deepStrictEqual([r.full, r.how, r.added], ['we agreed on the rules. Next the agenda for today', 'scroll', 'for today']);
});
test('stitch: the window grows', () => assert.strictEqual(st('Hello', 'Hello', 'Hello there').full, 'Hello there'));
test('stitch: the last words are revised', () => assert.strictEqual(st('we should ship on tuesday', 'we should ship on tuesday', 'we should ship next tuesday morning').full, 'we should ship next tuesday morning'));
test('stitch: the start scrolls out of view', () => {
  const r = st('A quick brown fox jumps over the lazy dog', 'A quick brown fox jumps over the lazy dog', 'fox jumps over the lazy dog again');
  assert.strictEqual(r.full, 'A quick brown fox jumps over the lazy dog again');
  assert.strictEqual(r.how, 'scroll');
});
test('stitch: scroll keeps the earlier part of the block', () => {
  const r = st('The first sentence here. second part of it', 'second part of it', 'part of it and more');
  assert.strictEqual(r.full, 'The first sentence here. second part of it and more');
});
test('stitch: scroll plus a revision of the tail', () => {
  const r = st('one two three four five six', 'one two three four five six', 'three four fife six seven');
  assert.strictEqual(r.full, 'one two three four fife six seven');
});
test('stitch: no overlap means the block started over, so the text is kept and continued', () => {
  const r = st('I think we should go', 'I think we should go', 'I want');
  assert.strictEqual(r.full, 'I think we should go I want');
  assert.strictEqual(r.how, 'append');
});
test('stitch: a shorter window that is a prefix replaces (recognition took words back)', () => assert.strictEqual(st('Hi there', 'Hi there', 'Hi').full, 'Hi'));
test('stitch: short words still align when the whole window matches', () => assert.strictEqual(st('Hi', 'Hi', 'Hi there').full, 'Hi there'));
test('stitch: empty text is ignored, identical text is a no-op', () => {
  assert.strictEqual(st('Hello', 'Hello', '   ').how, 'ignored');
  assert.strictEqual(st('Hello', 'Hello', 'Hello').how, 'same');
});
test('stitch: whitespace is normalised', () => assert.strictEqual(st('a b', 'a b', 'a   b\n c').full, 'a b c'));

// ------------------------------------------------------------------ transcript
test('transcript: one block grows into one entry, a re-rendered block continues it', () => {
  let t = 1000;
  const tr = M.createTranscript({ now: () => t });
  tr.upsert(1, 'Priya', 'Hi everyone');
  t += 500; tr.upsert(1, 'Priya', 'Hi everyone, thanks for joining');
  t += 500; tr.upsert(1, 'Priya', 'thanks for joining today');
  assert.strictEqual(tr.all().length, 1);
  assert.strictEqual(tr.all()[0].full, 'Hi everyone, thanks for joining today');
  tr.release(1);
  assert.strictEqual(tr.all()[0].final, true);
  t += 300; const { entry } = tr.upsert(2, 'Priya', 'Hi everyone, thanks for joining today');
  assert.strictEqual(entry.id, 1, 'same entry after Meet re-rendered the block');
  assert.strictEqual(tr.all().length, 1);
  assert.strictEqual(entry.final, false);
});
test('transcript: a new short utterance later is a new entry, another speaker always is', () => {
  let t = 1000;
  const tr = M.createTranscript({ now: () => t });
  tr.upsert(1, 'Sam', 'Yes.');
  tr.release(1);
  t += 20000; tr.upsert(2, 'Sam', 'Yes.');
  assert.strictEqual(tr.all().length, 2);
  tr.upsert(3, 'Ana', 'Yes.');
  assert.strictEqual(tr.all().length, 3);
  assert.strictEqual(tr.boundKeys().length, 2);
});
test('transcript: changed flag and timestamps', () => {
  let t = 5000;
  const tr = M.createTranscript({ now: () => t });
  const a = tr.upsert(1, 'A', 'one');
  assert.strictEqual(a.changed, true);
  assert.strictEqual(a.entry.startedAt, 5000);
  t = 6000; const b = tr.upsert(1, 'A', 'one');
  assert.strictEqual(b.changed, false);
  assert.strictEqual(b.entry.updatedAt, 5000);
  t = 7000; const c = tr.upsert(1, 'A', 'one two');
  assert.strictEqual(c.changed, true);
  assert.strictEqual(c.entry.updatedAt, 7000);
});

// ------------------------------------------------------------------ change detector
const sig = (fn) => { const a = new Uint8Array(M.SIG_W * M.SIG_H); for (let i = 0; i < a.length; i++) a[i] = fn(i); return a; };
const A = sig((i) => (i * 7) % 256), B = sig((i) => (i * 13 + 90) % 256), C = sig((i) => (i * 31 + 5) % 256), D = sig((i) => (i * 53 + 200) % 256), BLANK = sig(() => 40);
test('detector: a new picture is kept at first sight, then once more when it has settled', () => {
  const d = M.createChangeDetector({ threshold: 0.035, settleMs: 1500, minGapMs: 1200, quickEveryMs: 2500, timerMs: 0 });
  assert.strictEqual(d.sample(BLANK, 'v1', 0), null, 'blank frames never count');
  assert.strictEqual(d.sample(A, 'v1', 2000), 'first frame');
  d.saved(A, 2000);
  assert.strictEqual(d.sample(A, 'v1', 4000), null);
  assert.strictEqual(d.sample(B, 'v1', 6000), 'screen changed', 'kept the moment it appears');
  d.saved(B, 6000);
  assert.strictEqual(d.sample(B, 'v1', 7000), null, 'settled on the same picture: nothing new to keep');
  assert.strictEqual(d.sample(C, 'v1', 8000), null, 'moving: the quick look is rationed to one per 2.5 s');
  assert.strictEqual(d.sample(C, 'v1', 9000), null, 'not settled yet');
  assert.strictEqual(d.sample(C, 'v1', 9500), 'screen changed', 'settled on a picture that was never kept');
  d.saved(C, 9500);
  assert.strictEqual(d.sample(D, 'v1', 10500), null, 'moving, and too soon after the last one');
  assert.strictEqual(d.sample(C, 'v1', 11200), null, 'back to the picture kept a moment ago');
  assert.strictEqual(d.sample(D, 'v1', 12000), 'screen changed', 'a new picture, kept at first sight');
  d.saved(D, 12000);
});
test('detector: a picture kept a moment ago is not kept again, a new source is, a timer adds more', () => {
  const d = M.createChangeDetector({ threshold: 0.035, settleMs: 1000, minGapMs: 1200, quickEveryMs: 1000, timerMs: 10000, dupeWindowMs: 60000 });
  assert.strictEqual(d.sample(A, 'v1', 1000), 'first frame'); d.saved(A, 1000);
  assert.strictEqual(d.sample(B, 'v1', 3000), 'screen changed'); d.saved(B, 3000);
  assert.strictEqual(d.sample(A, 'v1', 5000), null, 'back to a slide seen 4 s ago');
  assert.strictEqual(d.sample(A, 'v1', 6000), null, 'still that slide, settled');
  assert.strictEqual(d.sample(A, 'v1', 13000), 'timer', 'the timer still fires on it');
  d.saved(A, 13000);
  assert.strictEqual(d.sample(A, 'v2', 13500), null, 'new source, too soon after a save');
  assert.strictEqual(d.sample(A, 'v2', 14300), 'new source');
  d.saved(A, 14300);
  assert.strictEqual(d.sample(B, 'v2', 70000), 'screen changed', 'the same slide again, long after: kept');
});
test('detector: a picture that keeps changing (video, scrolling) is kept only every so often', () => {
  const d = M.createChangeDetector({ threshold: 0.035, settleMs: 1000, minGapMs: 1000, quickEveryMs: 1000, timerMs: 0, busyAfter: 3, busyEveryMs: 5000 });
  const frames = [A, B, C, D, A, B, C, D, A, B];
  let t = 1000, kept = [];
  for (const f of frames) { const r = d.sample(f, 'v1', t); if (r) { kept.push(t); d.saved(f, t); } t += 1000; }
  assert.deepStrictEqual(kept, [1000, 2000, 3000, 8000], 'three quick ones, then one every 5 s');
});
test('detector: difference and blank', () => {
  assert.strictEqual(M.difference(A, A), 0);
  assert.ok(M.difference(A, B) > 0.1);
  assert.ok(M.isBlank(BLANK));
  assert.ok(!M.isBlank(A));
});

test('transcript: one block that runs on is cut into lines at pauses', () => {
  let t = 1000;
  const tr = M.createTranscript({ now: () => t });
  tr.upsert(1, 'You', 'Hi!');
  t += 400; tr.upsert(1, 'You', 'Hi, how?');
  t += 400; tr.upsert(1, 'You', 'Hi, how are you?');
  t += 5000; tr.upsert(1, 'You', 'Hi, how are you? So I have been looking into these things');
  t += 500; tr.upsert(1, 'You', 'Hi, how are you? So I have been looking into these things lately');
  t += 500; tr.upsert(1, 'You', 'So I have been looking into these things lately over the weekend');
  const lines = tr.allLines();
  assert.deepStrictEqual(lines.map((l) => [l.id, l.text, l.startedAt, l.split]), [
    ['1', 'Hi, how are you?', 1000, false],
    ['1.1', 'So I have been looking into these things lately over the weekend', 6800, true],
  ]);
  assert.strictEqual(lines[0].updatedAt, 1800);
});
test('transcript: a long run breaks at a sentence end, and a cut never lands mid-word', () => {
  let t = 0;
  const tr = M.createTranscript({ now: () => t, longMs: 10000 });
  let text = 'One.';
  tr.upsert(1, 'A', text);
  for (let i = 0; i < 12; i++) { t += 1000; text += ' two'; tr.upsert(1, 'A', text); }   // no sentence end yet: no cut
  assert.strictEqual(tr.allLines().length, 1);
  t += 1000; text += ' three.'; tr.upsert(1, 'A', text);
  t += 1000; text += ' Four five'; tr.upsert(1, 'A', text);                                // after a sentence end, past 10 s: cut here
  const lines = tr.allLines();
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[1].text, 'Four five');
  t += 1000; text = text.replace('three.', 'three, yes.'); text += ' six'; tr.upsert(1, 'A', text); // a revision before the cut
  const after = tr.allLines();
  assert.strictEqual(after.length, 2);
  assert.ok(after[0].text.endsWith('three, yes.'), after[0].text);
  assert.strictEqual(after[1].text, 'Four five six');
});
test('transcript: lines of a block with no cuts keep the entry id as before', () => {
  const tr = M.createTranscript({ now: () => 5 });
  tr.upsert(7, 'B', 'Hello');
  assert.deepStrictEqual(tr.allLines().map((l) => l.id), ['1']);
});

// ------------------------------------------------------------------ export
const T0 = Date.UTC(2026, 9, 21, 9, 30, 0);
const meeting = { id: 'abc', code: 'abc-defg-hij', title: 'Weekly: design/sync?', startedAt: T0, endedAt: T0 + 42 * 60000 };
const lines = [
  { id: 1, speaker: 'Jesh', text: 'Hello everyone.', startedAt: T0 + 3000, updatedAt: T0 + 5000 },
  { id: 2, speaker: 'Jesh', text: 'Hello everyone. Welcome to the sync.', startedAt: T0 + 5200, updatedAt: T0 + 9000 },
  { id: 3, speaker: 'Priya', text: 'Thanks. First the *design* rules.', startedAt: T0 + 12000, updatedAt: T0 + 15000 },
  { id: 4, speaker: 'Priya', text: 'Second, the agenda.', startedAt: T0 + 16000, updatedAt: T0 + 17000 },
  { id: 5, speaker: 'Priya', text: 'Second, the agenda.', startedAt: T0 + 30000, updatedAt: T0 + 31000 },
];
const snaps = [{ takenAt: T0 + 10000, reason: 'screen changed', source: 'Priya (Presentation)', width: 1600, height: 900, format: 'png', bytes: new Uint8Array([137, 80, 78, 71]) }, { takenAt: T0 + 99000, reason: 'manual', source: 'Priya (Presentation)', width: 1600, height: 900, format: 'png', bytes: new Uint8Array([1]) }];
test('tidyLines merges a growing block and drops repeats', () => {
  const t = M.tidyLines(lines);
  assert.deepStrictEqual(t.map((l) => l.text), ['Hello everyone. Welcome to the sync.', 'Thanks. First the *design* rules. Second, the agenda.']);
});
test('markdown: title, participants, preface, snapshot list and markers in order', () => {
  const md = M.buildMarkdown({ meeting, lines, snapshots: snaps, settings: { preface: 'Summarise decisions.' } });
  assert.ok(md.startsWith('# Weekly: design/sync?\n'));
  assert.ok(md.includes('Participants who spoke: Jesh, Priya'));
  assert.ok(md.includes('## For Claude\n\nSummarise decisions.'));
  assert.ok(md.includes('## Screen snapshots (2)'));
  assert.ok(md.includes('snapshot-01.png · screen changed · Priya (Presentation)'));
  const i1 = md.indexOf('Jesh:**'), m1 = md.indexOf('📷 Snapshot 1'), i2 = md.indexOf('Priya:**'), m2 = md.indexOf('📷 Snapshot 2');
  assert.ok(i1 < m1 && m1 < i2 && i2 < m2, 'markers sit between the right lines');
  assert.ok(md.includes('\\*design\\*'), 'markdown characters in captions are escaped');
  assert.ok(!md.includes('## For Claude\n\n\n'));
});
test('markdown and json: "You" becomes the setting, else the self-tile name, else stays', () => {
  const you = [{ id: 1, speaker: 'You', text: 'Hello.', startedAt: T0 + 1000, updatedAt: T0 + 2000 }, { id: 2, speaker: 'Priya', text: 'Hi.', startedAt: T0 + 5000, updatedAt: T0 + 6000 }];
  const m = { ...meeting, myName: 'Jesh Shiva' };
  assert.ok(M.buildMarkdown({ meeting: m, lines: you, snapshots: [], settings: { myName: 'Jesh' } }).includes('] Jesh:** Hello.'));
  assert.ok(M.buildMarkdown({ meeting: m, lines: you, snapshots: [], settings: { myName: 'Jesh' } }).includes('Participants who spoke: Jesh, Priya'));
  assert.ok(M.buildMarkdown({ meeting: m, lines: you, snapshots: [], settings: {} }).includes('] Jesh Shiva:** Hello.'));
  assert.ok(M.buildMarkdown({ meeting, lines: you, snapshots: [], settings: {} }).includes('] You:** Hello.'));
  const j = JSON.parse(M.buildJson({ meeting: m, lines: you, snapshots: [], settings: { myName: 'Jesh' } }));
  assert.strictEqual(j.lines[0].speaker, 'Jesh');
  assert.strictEqual(j.meeting.myName, 'Jesh');
});
test('markdown: no captions', () => {
  const md = M.buildMarkdown({ meeting, lines: [], snapshots: [], settings: {} });
  assert.ok(md.includes('No captions were captured'));
  assert.ok(!md.includes('## Screen snapshots'));
});
test('exportFiles: transcript, images, optional json', () => {
  const files = M.exportFiles({ meeting, lines, snapshots: snaps, settings: { includeJson: true } });
  assert.deepStrictEqual(files.map((f) => f.name), ['transcript.md', 'snapshot-01.png', 'snapshot-02.png', 'meeting.json']);
  assert.strictEqual(files[1].mime, 'image/png');
  const j = JSON.parse(files[3].data);
  assert.strictEqual(j.snapshots[0].file, 'snapshot-01.png');
  assert.strictEqual(j.lines.length, 5);
  assert.strictEqual(M.exportFiles({ meeting, lines, snapshots: snaps, settings: {} }).length, 3);
});
test('names: fileSafe, folderName, snapshotFile', () => {
  assert.strictEqual(M.fileSafe('Weekly: design/sync?'), 'Weekly design sync');
  assert.strictEqual(M.fileSafe('CON'), '_CON');
  assert.strictEqual(M.fileSafe('..'), '_');
  assert.strictEqual(M.fileSafe('a​b‮c'), 'abc');
  assert.ok(M.fileSafe('x'.repeat(100)).length <= 60);
  assert.ok(/^Meet captures\/2026-10-21 \d\d\.\d\d Weekly design sync$/.test(M.folderName(meeting)), M.folderName(meeting));
  assert.strictEqual(M.snapshotFile(3, 'jpeg'), 'snapshot-03.jpg');
  assert.strictEqual(M.snapshotFile(12, 'png'), 'snapshot-12.png');
});
test('settings: defaults win over wrong types, speaker alias', () => {
  const s = M.settingsWithDefaults({ myName: 'Jesh', snapshotEverySec: 'ten', afterCall: 'zip', openPanel: false, extra: 1 });
  assert.strictEqual(s.myName, 'Jesh');
  assert.strictEqual(s.snapshotEverySec, 60);
  assert.strictEqual(s.afterCall, 'zip');
  assert.strictEqual(s.openPanel, false);
  assert.strictEqual(s.extra, undefined);
  assert.strictEqual(M.settingsWithDefaults(null).afterCall, 'open');
  assert.strictEqual(M.speakerAlias('You', 'Jesh'), 'Jesh');
  assert.strictEqual(M.speakerAlias('Vous', 'Jesh'), 'Jesh');
  assert.strictEqual(M.speakerAlias('You', ''), 'You');
  assert.strictEqual(M.speakerAlias('Youssef', 'Jesh'), 'Youssef');
});

// ------------------------------------------------------------------ zip
test('zip: crc32 and a readable archive', () => {
  assert.strictEqual(M.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const chunks = M.makeZip([{ path: 'm/transcript.md', data: '# hi\n' }, { path: 'm/snapshot-01.png', data: new Uint8Array([137, 80, 78, 71]) }], new Date(2026, 9, 21, 12, 0, 0));
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50);
  const eocd = buf.length - 22;
  assert.strictEqual(buf.readUInt32LE(eocd), 0x06054b50);
  assert.strictEqual(buf.readUInt16LE(eocd + 10), 2, 'two entries');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  assert.strictEqual(buf.readUInt32LE(cdOffset), 0x02014b50);
  const nameLen = buf.readUInt16LE(cdOffset + 28);
  assert.strictEqual(buf.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen), 'm/transcript.md');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
