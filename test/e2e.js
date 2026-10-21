// End-to-end check of the real extension in Chromium against the fake Meet (no Google account needed).
// Run: node test/e2e.js [outDir]   Screenshots and the exported files land in outDir.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { launch } = require('./fake-meet');

const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'mcc-e2e'));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { ctx, sw, extId, errors, downloads } = await launch({ downloads: path.join(OUT, 'downloads') });
  global.__errors = errors;
  sw.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('worker console: ' + m.text()); });

  // 1. A call with captions, read by the content script.
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('page console: ' + m.text()); });
  await page.goto('https://meet.google.com/abc-defg-hij');
  await page.click('#join');
  await page.waitForSelector('#meet-capture-pill', { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('#cc').getAttribute('aria-pressed') === 'true', null, { timeout: 8000 });
  console.log('captions switched on by the extension');

  // 2. The side panel, opened as a tab.
  const panel = await ctx.newPage();
  panel.on('pageerror', (e) => errors.push('panel: ' + e.message));
  panel.on('console', (m) => { if (m.type() === 'error') errors.push('panel console: ' + m.text()); });
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.waitForSelector('.live', { timeout: 8000 });
  await panel.waitForFunction(() => /\b[3-9]\d* lines|\b\d{2,} lines/.test(document.querySelector('#chip-lines').textContent), null, { timeout: 25000 });
  await panel.waitForFunction(() => /\b[1-9]\d* snapshots?/.test(document.querySelector('#chip-snaps').textContent), null, { timeout: 25000 });
  console.log('panel shows:', await panel.textContent('#chip-lines'), '/', await panel.textContent('#chip-snaps'), '/', await panel.textContent('#cc'));
  await page.bringToFront();
  await page.screenshot({ path: path.join(OUT, '1-meet-with-pill.png') });
  await panel.bringToFront();
  await panel.screenshot({ path: path.join(OUT, '2-panel-live.png'), fullPage: true });
  await panel.emulateMedia({ colorScheme: 'dark' });
  await panel.screenshot({ path: path.join(OUT, '2-panel-live-dark.png'), fullPage: true });
  await panel.emulateMedia({ colorScheme: 'light' });

  // 3. A manual snapshot from the panel, the source picker, the settings view.
  const before = Number((await panel.textContent('#chip-snaps')).match(/\d+/)[0]);
  await panel.click('[data-action="snapshot"]');
  await panel.waitForFunction((n) => Number(document.querySelector('#chip-snaps').textContent.match(/\d+/)[0]) > n, before, { timeout: 5000 });
  console.log('manual snapshot taken');
  await panel.click('[data-action="change-source"]');
  await panel.waitForSelector('.pick', { timeout: 5000 });
  const picks = await panel.$$eval('.pick li', (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')));
  console.log('source picker:', picks.join(' | '));
  if (!picks.some((p) => /presenting/.test(p))) errors.push('the presentation video was not recognised in the picker');
  await panel.screenshot({ path: path.join(OUT, '3-panel-picker.png'), fullPage: true });
  await panel.click('[data-action="cancel-source"]');
  await panel.click('#settings-btn');
  await panel.waitForSelector('.settings', { timeout: 3000 });
  await panel.fill('#preface', 'Summarise the decisions and list action items with owners.');
  await sleep(600);
  await panel.screenshot({ path: path.join(OUT, '4-panel-settings.png'), fullPage: true });
  await panel.click('[data-action="close-settings"]');
  await panel.waitForSelector('.live', { timeout: 3000 });

  // 4. Leave the call: the export runs by itself.
  await page.waitForFunction(() => window.__fake && window.__fake.done, null, { timeout: 30000 }); // the caption timeline is over
  await sleep(1500);
  await page.bringToFront();
  await page.click('#leave');
  await panel.bringToFront();
  await panel.waitForSelector('.list li', { timeout: 15000 });
  const items = await waitForDownloads(sw, 2, 30000);
  console.log('downloads:', items.map((d) => `${path.basename(d.filename)} (${d.state}, ${d.totalBytes} B)`).join(', '));
  await sleep(500);
  await panel.screenshot({ path: path.join(OUT, '5-panel-after.png'), fullPage: true });
  const md = items.find((d) => /transcript\.md$/.test(d.filename) || d.mime === 'text/markdown');
  if (!md) errors.push('no transcript.md was downloaded');
  else {
    const text = fs.readFileSync(md.filename, 'utf8');
    fs.writeFileSync(path.join(OUT, 'transcript.md'), text);
    console.log('--- transcript.md ---\n' + text + '--- end ---');
    const expectOnce = (s) => { const n = text.split(s).length - 1; if (n !== 1) errors.push(`expected exactly once in transcript: "${s}" (found ${n})`); };
    expectOnce('Hi everyone, thanks for joining today. Let me share the design rules we agreed on last week and the agenda');
    expectOnce('Sounds good, go ahead. Yes it is out');
    expectOnce('One question first: is the generic layout out for good?');
    expectOnce('Great, moving on to the agenda for today');
    expectOnce('Hi, how are you?');
    expectOnce('Jesh Shiva:** So I have been looking into these things lately over the weekend and I think we can connect');
    if (/Hi, how are you\? So I have been/.test(text)) errors.push('the long block was not cut into two lines at the pause');
    if (!/\*\*\[\d\d:\d\d:\d\d\] Jesh Shiva:\*\* Sounds good/.test(text)) errors.push('"You" was not replaced by the name from the self tile');
    if (!text.includes('📷 Snapshot 1')) errors.push('no snapshot marker in the transcript');
    if (!text.includes('## For Claude')) errors.push('the preface is missing');
    if (!/Participants who spoke: Priya Natarajan, Jesh Shiva, Sam Okafor/.test(text)) errors.push('participants line is wrong');
    if (!text.includes('Priya Natarajan is presenting')) errors.push('the snapshot source label is missing');
  }
  for (const d of items.filter((x) => /\.png$/.test(x.filename) || x.mime === 'image/png')) {
    const head = fs.readFileSync(d.filename).subarray(0, 8);
    if (head.toString('hex') !== '89504e470d0a1a0a') errors.push('not a PNG: ' + d.filename);
    fs.copyFileSync(d.filename, path.join(OUT, path.basename(d.filename)));
  }
  const rec = (await sw.evaluate(() => MCC.store.listMeetings()))[0];
  console.log('export folder:', rec.exportFolder, '| files:', (rec.exportFiles || []).join(', '), '| title:', rec.title);
  if (!/^Meet captures\/\d{4}-\d\d-\d\d \d\d\.\d\d Weekly design sync$/.test(rec.exportFolder || '')) errors.push('unexpected export folder name: ' + rec.exportFolder);
  // Playwright renames files it intercepts, so the on-disk name is not checked here; the intended path is in the record.

  // 5. Export again as one ZIP with a name set in the settings, then copy the transcript.
  await sw.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, exportFormat: 'zip', includeJson: true, myName: 'Jesh' } }); });
  await sleep(300);
  await panel.click('.list li [data-action="export"]');
  const zipItems = await waitForDownloads(sw, items.length + 1, 30000);
  const zip = zipItems.find((d) => /\.zip$/.test(d.filename) || d.mime === 'application/zip');
  if (!zip) errors.push('no ZIP was downloaded');
  else {
    const unz = path.join(OUT, 'unzipped'); fs.mkdirSync(unz, { recursive: true });
    execFileSync('unzip', ['-q', '-o', zip.filename, '-d', unz]);
    const listing = execFileSync('find', ['.', '-type', 'f'], { cwd: unz }).toString().trim().split('\n').sort();
    console.log('zip:', path.basename(zip.filename), '\n ' + listing.join('\n '));
    if (!listing.some((f) => /meeting\.json$/.test(f))) errors.push('meeting.json missing from the ZIP');
    const mdIn = listing.find((f) => /transcript\.md$/.test(f));
    if (!mdIn) errors.push('transcript.md missing from the ZIP');
    else {
      const t2 = fs.readFileSync(path.join(unz, mdIn), 'utf8');
      if (!/\*\*\[\d\d:\d\d:\d\d\] Jesh:\*\* Sounds good/.test(t2)) errors.push('the name from the settings was not applied to the ZIP transcript');
      if (t2.includes('Jesh Shiva')) errors.push('the self-tile name still appears after a rename in the settings');
      const jIn = listing.find((f) => /meeting\.json$/.test(f));
      if (jIn && !JSON.parse(fs.readFileSync(path.join(unz, jIn), 'utf8')).lines.some((l) => l.speaker === 'Jesh')) errors.push('meeting.json does not use the renamed speaker');
    }
  }
  await panel.evaluate(() => { window.__copied = ''; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await panel.click('.list li [data-action="copy"]');
  await panel.waitForFunction(() => window.__copied, null, { timeout: 5000 });
  const clip = await panel.evaluate(() => window.__copied);
  console.log('copied transcript:', clip.length, 'characters;', await panel.textContent('#toast'));
  if (!/^# Weekly design sync/.test(clip)) errors.push('the copied text is not the transcript');
  if (!clip.includes('] Jesh:** Sounds good')) errors.push('the copied transcript does not use the renamed speaker');

  // 6. A reload mid-call continues the same meeting instead of starting a second one.
  await page.bringToFront();
  await page.click('#rejoin');
  await page.waitForSelector('#meet-capture-pill', { timeout: 8000 });
  await sleep(2500);
  const n1 = (await sw.evaluate(() => MCC.store.listMeetings())).length;
  await page.reload();
  await page.click('#join');
  await page.waitForSelector('#meet-capture-pill', { timeout: 8000 });
  await sleep(2500);
  const after = await sw.evaluate(() => MCC.store.listMeetings());
  console.log('meetings after a reload mid-call:', after.length, '(before reload:', n1 + ')');
  if (after.length !== n1) errors.push('a reload mid-call started a new meeting record');
  if (after.filter((m) => m.status === 'live').length !== 1) errors.push('expected exactly one live meeting after the reload');
  await page.click('#leave');
  await sleep(2500);

  await ctx.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
  process.exitCode = errors.length ? 1 : 0;
})().catch((e) => { console.error(e); if (global.__errors && global.__errors.length) console.error('collected so far:\n' + global.__errors.join('\n')); process.exit(1); });

async function waitForDownloads(sw, count, timeout) {
  const t0 = Date.now();
  for (;;) {
    const items = await sw.evaluate(() => chrome.downloads.search({ orderBy: ['startTime'] }));
    const done = items.filter((d) => d.state === 'complete');
    if (done.length >= count) return done;
    if (items.some((d) => d.state === 'interrupted')) throw new Error('a download was interrupted: ' + JSON.stringify(items.find((d) => d.state === 'interrupted')));
    if (Date.now() - t0 > timeout) throw new Error(`only ${done.length} of ${count} downloads completed: ` + JSON.stringify(items.map((d) => ({ f: d.filename, s: d.state, e: d.error }))));
    await sleep(400);
  }
}
