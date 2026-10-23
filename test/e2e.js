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
const PANEL = '#meet-capture-panel .panel';
// Playwright's selectors reach into the panel's shadow root; code run inside the page needs this hand.
const PANEL_FN = `(() => { const h = document.querySelector('#meet-capture-panel'); return h && h.shadowRoot && h.shadowRoot.querySelector('.panel'); })()`;
const panelFn = (body) => new Function('n', `const panel = ${PANEL_FN}; if (!panel) return false; ${body}`);

(async () => {
  const { ctx, sw, extId, errors, downloads } = await launch({ downloads: path.join(OUT, 'downloads') });
  global.__errors = errors;
  sw.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('worker console: ' + m.text()); });
  const watch = (p, name) => { p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); }); };

  // 1. A call: the button joins Meet's bar, the panel opens, captions switch on, lines and snapshots arrive.
  const page = await ctx.newPage();
  watch(page, 'meet');
  await page.goto('https://meet.google.com/abc-defg-hij');
  await page.click('#join');
  await page.waitForSelector('#meet-capture-button button', { timeout: 8000 });
  const after = await page.$eval('#meet-capture-button', (el) => el.previousElementSibling && el.previousElementSibling.querySelector('button') && el.previousElementSibling.querySelector('button').getAttribute('aria-label'));
  console.log('capture button sits after:', after);
  if (after !== 'Chat with everyone') errors.push('the capture button is not next to the Chat button: ' + after);
  await page.waitForSelector(`${PANEL}.open`, { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('#cc').getAttribute('aria-pressed') === 'true', null, { timeout: 8000 });
  console.log('captions switched on by the extension; panel open');
  await page.waitForFunction(panelFn("return panel.querySelectorAll('.msg').length >= 3;"), null, { timeout: 25000 });
  await page.waitForFunction(panelFn("return panel.querySelectorAll('.snap').length >= 1;"), null, { timeout: 25000 });
  const status = await page.$eval(`${PANEL} [data-el="status"]`, (el) => el.textContent);
  console.log('panel status:', status);
  if (!/^Capturing · \d+:\d\d · \d+ lines · \d+ snapshots?$/.test(status)) errors.push('unexpected panel status: ' + status);
  await page.screenshot({ path: path.join(OUT, '1-meet-panel.png') });

  // 2. A manual snapshot from the panel; the mode select writes the setting; Meet's own panels close ours; the bar button reopens it.
  const count = () => page.$eval(`${PANEL} [data-el="status"]`, (el) => Number(el.textContent.match(/(\d+) snapshot/)[1]));
  const before = await count();
  await page.click(`${PANEL} [data-act="snapshot"]`);
  await page.waitForFunction(panelFn("return Number(panel.querySelector('[data-el=\"status\"]').textContent.match(/(\\d+) snapshot/)[1]) > n;"), before, { timeout: 5000 });
  console.log('manual snapshot taken from the panel');
  await page.selectOption(`${PANEL} [data-el="mode"]`, 'both');
  await sleep(400);
  const modeSetting = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.snapshotMode);
  if (modeSetting !== 'both') errors.push('the mode select did not write the setting: ' + modeSetting);
  await page.selectOption(`${PANEL} [data-el="mode"]`, 'change');
  const sources = await page.$$eval(`${PANEL} [data-el="sources"] option`, (els) => els.map((o) => o.textContent));
  console.log('source picker:', sources.join(' | '));
  if (!sources.some((s) => /presenting/.test(s))) errors.push('the presentation video was not recognised as a source');
  await page.click('button[aria-label="Chat with everyone"]');
  await page.waitForFunction(panelFn("return !panel.classList.contains('open');"), null, { timeout: 3000 });
  await page.click('#meet-capture-button button');
  await page.waitForSelector(`${PANEL}.open`, { timeout: 3000 });
  console.log('panel closes for Meet\'s chat and reopens from the bar button');

  // 2b. Presenting yourself, as Meet shows it (a plain-text "Stop presenting" button, "Name (You, presenting)", a preview tile of
  //     your own share): the bar button's badge turns amber while the panel is closed, the panel offers to capture your share, lists
  //     Meet's preview under its own name, and your name is read from the page. Chrome's picker is auto-selected in this run;
  //     headless screens can be blank, so only the offer and the capture itself are required to work.
  await page.click('#meet-capture-button button');
  await page.waitForFunction(panelFn("return !panel.classList.contains('open');"), null, { timeout: 3000 });
  await page.click('#present');
  await page.waitForFunction(() => { const h = document.querySelector('#meet-capture-button'); const b = h && h.shadowRoot && h.shadowRoot.querySelector('.badge'); return !!b && b.classList.contains('ask'); }, null, { timeout: 5000 });
  console.log('presenting: the bar button\'s badge turns amber while the panel is closed');
  await page.click('#meet-capture-button button');
  await page.waitForSelector(`${PANEL} [data-act="share"]`, { timeout: 5000 });
  await page.waitForFunction(panelFn("return [...panel.querySelectorAll('[data-el=\"sources\"] option')].some((o) => /Meet's preview of your share/.test(o.textContent));"), null, { timeout: 8000 });
  const myName = await sw.evaluate(async () => (await MCC.store.listMeetings())[0].myName);
  console.log('presenting: the panel offers Capture my share and lists Meet\'s preview of the share by name; your name read from the page:', JSON.stringify(myName));
  if (myName !== 'Jesh Shiva') errors.push('the name was not read from Meet\'s "(You, presenting)" label: ' + JSON.stringify(myName));
  await page.click(`${PANEL} [data-act="share"]`);
  const shared = await page.waitForFunction(panelFn("return /Capturing your screen share/.test(panel.querySelector('[data-el=\"callout\"]').textContent);"), null, { timeout: 8000 }).then(() => true).catch(() => false);
  if (shared) {
    const t0 = Date.now(); let srcs = [];
    while (Date.now() - t0 < 8000 && !srcs.includes('Your screen share')) { await sleep(500); srcs = await sw.evaluate(async () => { const m = (await MCC.store.listMeetings())[0]; return (await MCC.store.getSnapshots(m.id)).map((x) => x.source); }); }
    console.log('share captured; snapshot sources so far:', [...new Set(srcs)].join(' | ') || '(none)', srcs.includes('Your screen share') ? '' : '(no frame of the share yet: a blank headless screen gives none)');
  } else console.log('getDisplayMedia did not start in this headless run; share capture skipped');
  await page.click('#present');
  await page.waitForFunction(panelFn("return !/Capturing your screen share/.test(panel.querySelector('[data-el=\"callout\"]').textContent) || panel.querySelector('[data-el=\"callout\"]').hidden;"), null, { timeout: 5000 });

  // 3. Leave the call: the captures page opens by itself on this meeting; a card stays on Meet's "You left" page.
  await page.waitForFunction(() => window.__fake && window.__fake.done, null, { timeout: 30000 }); // the caption timeline is over
  await sleep(1500);
  const appPromise = ctx.waitForEvent('page', { timeout: 15000 });
  await page.click('#leave');
  const app = await appPromise;
  watch(app, 'app');
  await app.waitForLoadState();
  console.log('captures page opened at:', app.url().replace(/^chrome-extension:\/\/[a-z]+/, ''));
  if (!/\/app\/index\.html#m=abc-defg-hij-/.test(app.url())) errors.push('the captures page did not open on the meeting: ' + app.url());
  await page.waitForSelector('#meet-capture-after .card', { timeout: 8000 });
  const cardText = await page.$eval('#meet-capture-after .card', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  console.log('card on the left page:', cardText);
  if (!/Meeting captured/.test(cardText)) errors.push('no "Meeting captured" card after the call');
  await page.screenshot({ path: path.join(OUT, '2-meet-left-card.png') });
  await app.bringToFront();
  await app.waitForSelector('.tl .line', { timeout: 15000 });
  await app.waitForFunction(() => !document.querySelector('.meta .live'), null, { timeout: 15000 });
  await app.waitForSelector('.figure img', { timeout: 5000 });
  await app.waitForSelector('.strip .tick', { timeout: 5000 });
  await sleep(400);
  await app.screenshot({ path: path.join(OUT, '3-app-meeting.png'), fullPage: true });
  const n = await app.$$eval('.tl .line .text', (els) => els.length);
  const thumbs = await app.$$eval('.figure', (els) => els.length);
  const ticks = await app.$$eval('.strip .tick', (els) => els.length);
  console.log('captures page shows', n, 'lines and', thumbs, 'snapshots;', ticks, 'marks on the line');
  if (ticks !== thumbs) errors.push(`the meeting line has ${ticks} marks for ${thumbs} snapshots`);
  // The line: hovering near a mark names the snapshot and shows it; clicking goes to it in the record.
  const tick = app.locator('.strip .tick').first(); // a locator: the marks are redrawn when the worker's state arrives, a handle could go stale
  await tick.scrollIntoViewIfNeeded();
  const box = await tick.boundingBox();
  await app.mouse.move(10, 400);
  await app.mouse.move(box.x + 1, box.y + 8, { steps: 6 });
  await app.waitForFunction(() => /^Snapshot 1 · /.test(document.querySelector('.strip [data-el="readout"]').textContent), null, { timeout: 3000 });
  const tipShown = await app.$eval('.strip [data-el="tip"]', (el) => !el.hidden && /^data:image/.test(el.querySelector('img').src));
  if (!tipShown) errors.push('hovering a mark on the line does not show the snapshot');
  await app.mouse.click(box.x + 1, box.y + 8);
  await app.waitForFunction(() => document.querySelector('#snap-1').classList.contains('hit'), null, { timeout: 3000 });
  console.log('the meeting line names and previews the snapshot on hover, and jumps to it on click');
  await app.mouse.move(10, 10);

  // 4. Copy the transcript and check it.
  await app.evaluate(() => { window.__copied = ''; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await app.click('[data-act="copy"]');
  await app.waitForFunction(() => window.__copied, null, { timeout: 5000 });
  const text = await app.evaluate(() => window.__copied);
  fs.writeFileSync(path.join(OUT, 'transcript.md'), text);
  console.log('--- transcript.md ---\n' + text + '--- end ---');
  const expectOnce = (s) => { const c = text.split(s).length - 1; if (c !== 1) errors.push(`expected exactly once in transcript: "${s}" (found ${c})`); };
  expectOnce('Hi everyone, thanks for joining today. Let me share the design rules we agreed on last week and the agenda');
  expectOnce('Sounds good, go ahead. Yes it is out');
  expectOnce('One question first: is the generic layout out for good?');
  expectOnce('Great, moving on to the agenda for today');
  expectOnce('Hi, how are you?');
  expectOnce('Jesh Shiva:** So I have been looking into these things lately over the weekend and I think we can connect');
  if (/Hi, how are you\? So I have been/.test(text)) errors.push('the long block was not cut into two lines at the pause');
  if (!/\*\*\[\d\d:\d\d:\d\d\] Jesh Shiva:\*\* Sounds good/.test(text)) errors.push('"You" was not replaced by the name from the self tile');
  if (!text.includes('📷 Snapshot 1')) errors.push('no snapshot marker in the transcript');
  if (!/Participants who spoke: Priya Natarajan, Jesh Shiva, Sam Okafor/.test(text)) errors.push('participants line is wrong');
  if (!text.includes('Priya Natarajan is presenting')) errors.push('the snapshot source label is missing');

  // 5. Open in Claude: a claude.ai tab with the transcript in the URL.
  const claudePromise = ctx.waitForEvent('page', { timeout: 10000 });
  await app.click('[data-act="claude"]');
  const claude = await claudePromise;
  await claude.waitForLoadState();
  const q = new URL(claude.url());
  console.log('Claude opened:', q.origin + q.pathname, '· prefill', (q.searchParams.get('q') || '').length, 'characters');
  if (q.origin !== 'https://claude.ai' || !(q.searchParams.get('q') || '').startsWith('# Weekly design sync')) errors.push('Open in Claude did not open claude.ai with the transcript: ' + claude.url());
  await claude.close();

  // 6. Settings: Escape drops an edit, Save keeps it, the timer field is greyed out unless a timer is in use.
  //    Then one ZIP from the page, with a name set in the settings and meeting.json on.
  await app.click('#settings-btn');
  await app.waitForSelector('#settings-form', { timeout: 3000 });
  await app.fill('#s-myName', 'Nobody');
  await app.keyboard.press('Escape');
  await app.waitForFunction(() => !document.querySelector('#settings').open, null, { timeout: 3000 });
  await sleep(300);
  const dropped = await sw.evaluate(async () => ((await chrome.storage.local.get('settings')).settings || {}).myName);
  if (dropped === 'Nobody') errors.push('Escape on the settings dialog kept the edit instead of dropping it');
  await app.click('#settings-btn');
  await app.waitForSelector('#settings-form', { timeout: 3000 });
  if (await app.$eval('#s-myName', (el) => el.value) === 'Nobody') errors.push('the dropped edit came back when the settings were opened again');
  if (!await app.$eval('#s-snapshotEverySec', (el) => el.disabled)) errors.push('the timer field is not greyed out while snapshots are taken on change only');
  await app.fill('#s-myName', 'Jesh');
  await app.check('input[name="includeJson"]');
  await app.fill('#s-preface', 'Summarise the decisions and list action items with owners.');
  await app.screenshot({ path: path.join(OUT, '4-app-settings.png') });
  await app.click('#s-save');
  await app.waitForFunction(() => !document.querySelector('#settings').open, null, { timeout: 3000 });
  await sleep(500);
  const saved = await sw.evaluate(async () => ((await chrome.storage.local.get('settings')).settings || {}).myName);
  if (saved !== 'Jesh') errors.push('Save did not keep the settings: myName is ' + JSON.stringify(saved));
  console.log('settings: Escape dropped an edit, Save kept the next one, the timer field is greyed out');
  await app.click('[data-act="zip"]');
  const items = await waitForDownloads(sw, 1, 30000);
  const zip = items.find((d) => /\.zip$/.test(d.filename) || d.mime === 'application/zip');
  console.log('downloads:', items.map((d) => `${path.basename(d.filename)} (${d.state}, ${d.totalBytes} B)`).join(', '));
  if (!zip) errors.push('no ZIP was downloaded');
  else {
    const unz = path.join(OUT, 'unzipped'); fs.mkdirSync(unz, { recursive: true });
    execFileSync('unzip', ['-q', '-o', zip.filename, '-d', unz]);
    const listing = execFileSync('find', ['.', '-type', 'f'], { cwd: unz }).toString().trim().split('\n').sort();
    console.log('zip:', path.basename(zip.filename), '\n ' + listing.join('\n '));
    if (!listing.some((f) => /meeting\.json$/.test(f))) errors.push('meeting.json missing from the ZIP');
    if (!listing.some((f) => /snapshot-01\.png$/.test(f))) errors.push('snapshot-01.png missing from the ZIP');
    if (!listing.some((f) => /\/\d{4}-\d\d-\d\d \d\d\.\d\d Weekly design sync\//.test(f))) errors.push('the ZIP folder is not named after the meeting');
    const mdIn = listing.find((f) => /transcript\.md$/.test(f));
    if (!mdIn) errors.push('transcript.md missing from the ZIP');
    else {
      const t2 = fs.readFileSync(path.join(unz, mdIn), 'utf8');
      if (!/\*\*\[\d\d:\d\d:\d\d\] Jesh:\*\* Sounds good/.test(t2)) errors.push('the name from the settings was not applied to the ZIP transcript');
      if (t2.includes('Jesh Shiva')) errors.push('the self-tile name still appears after a rename in the settings');
      if (!t2.includes('## For Claude')) errors.push('the preface is missing from the ZIP transcript');
      const png = listing.find((f) => /snapshot-01\.png$/.test(f));
      if (png) { const head = fs.readFileSync(path.join(unz, png)).subarray(0, 8); if (head.toString('hex') !== '89504e470d0a1a0a') errors.push('snapshot-01.png is not a PNG'); fs.copyFileSync(path.join(unz, png), path.join(OUT, 'snapshot-01.png')); }
    }
  }
  const rec = (await sw.evaluate(() => MCC.store.listMeetings()))[0];
  console.log('record: zip', rec.zipFile, '| title:', rec.title, '| status:', rec.status);
  if (!/^Meet captures\/\d{4}-\d\d-\d\d \d\d\.\d\d Weekly design sync\.zip$/.test(rec.zipFile || '')) errors.push('unexpected ZIP name: ' + rec.zipFile);

  // 7. Save to a folder: one picker, every file written, remembered on the record.
  await app.click('[data-act="folder"]');
  await app.waitForFunction(() => window.__fsFiles && window.__fsFiles.length >= 3, null, { timeout: 10000 });
  const written = await app.evaluate(() => window.__fsFiles.map((f) => `${f.path} (${f.size} B)`));
  console.log('written to the folder:\n ' + written.join('\n '));
  if (!written.some((f) => /Meet captures\/\d{4}-\d\d-\d\d \d\d\.\d\d Weekly design sync\/transcript\.md/.test(f))) errors.push('transcript.md was not written into the folder');
  if (!written.some((f) => /snapshot-01\.png/.test(f))) errors.push('snapshot-01.png was not written into the folder');
  await app.waitForFunction(() => /Saved to Meet captures/.test(document.querySelector('.note') ? document.querySelector('.note').textContent : ''), null, { timeout: 5000 });
  const folderBtn = await app.$eval('[data-act="folder"]', (el) => el.textContent.trim());
  console.log('folder button now says:', folderBtn);
  if (folderBtn !== 'Save to Meet captures') errors.push('the folder button does not show the chosen folder: ' + folderBtn);

  // 8. The lightbox and a rename.
  await app.click('.figure img');
  await app.waitForSelector('#lightbox[open] img', { timeout: 3000 });
  await app.waitForFunction(() => /^blob:/.test(document.querySelector('#lightbox img').src), null, { timeout: 5000 });
  await app.screenshot({ path: path.join(OUT, '5-app-lightbox.png') });
  await app.keyboard.press('Escape');
  await app.dblclick('#title');
  await app.fill('.title-edit', 'Design sync · renamed');
  await app.keyboard.press('Enter');
  await app.waitForFunction(() => document.querySelector('#title') && document.querySelector('#title').textContent === 'Design sync · renamed', null, { timeout: 3000 });
  await sleep(500);
  const renamed = await sw.evaluate(async () => (await MCC.store.listMeetings())[0].title);
  if (renamed !== 'Design sync · renamed') errors.push('the rename was not stored: ' + renamed);
  await app.keyboard.press('/'); // from a meeting, "/" goes to the index and lands in the search box
  await app.waitForSelector('#index .row', { timeout: 3000 });
  if (!(await app.evaluate(() => document.activeElement && document.activeElement.id === 'search'))) errors.push('"/" from a meeting did not focus the search box');
  const listTitle = await app.$eval('#index .row .rt', (el) => el.textContent);
  if (listTitle !== 'Design sync · renamed') errors.push('the index does not show the new title: ' + listTitle);
  const miniTicks = await app.$$eval('#index .row .mini i', (els) => els.length);
  if (!miniTicks) errors.push('the index row has no marks on its line');
  await app.screenshot({ path: path.join(OUT, '7-app-index.png') });
  console.log('renamed to:', renamed, '· index row shows', miniTicks, 'marks');

  // 9. A reload mid-call continues the same meeting instead of starting a second one; the page follows the live call.
  await page.bringToFront();
  await page.click('#rejoin');
  await page.waitForSelector(`${PANEL}.open`, { timeout: 8000 });
  await sleep(2500);
  const n1 = (await sw.evaluate(() => MCC.store.listMeetings())).length;
  await page.reload();
  await page.click('#join');
  await page.waitForSelector(`${PANEL}.open`, { timeout: 8000 });
  await sleep(2500);
  const afterReload = await sw.evaluate(() => MCC.store.listMeetings());
  console.log('meetings after a reload mid-call:', afterReload.length, '(before reload:', n1 + ')');
  if (afterReload.length !== n1) errors.push('a reload mid-call started a new meeting record');
  if (afterReload.filter((m) => m.status === 'live').length !== 1) errors.push('expected exactly one live meeting after the reload');
  await app.bringToFront();
  await app.waitForSelector('#index .row .live-dot', { timeout: 8000 });
  await app.click('#index .row:has(.live-dot)');
  await app.waitForSelector('.meta .live', { timeout: 5000 });
  await app.waitForFunction(() => document.querySelectorAll('.tl .line').length >= 1, null, { timeout: 25000 });
  await app.waitForSelector('.strip .now', { timeout: 5000 });
  await app.screenshot({ path: path.join(OUT, '6-app-live.png') });
  console.log('the captures page follows the live call');
  // The line is redrawn every second while live; the keyboard cursor and focus must survive that.
  await app.waitForSelector('.strip .tick', { timeout: 25000 });
  await app.focus('.strip');
  await app.keyboard.press('ArrowRight');
  await sleep(2300);
  const kept = await app.evaluate(() => document.activeElement === document.querySelector('.strip') && !!document.querySelector('.strip .tick.on') && document.querySelector('[data-el="readout"]').textContent.startsWith('Snapshot 1'));
  if (!kept) errors.push('the meeting line lost focus or its cursor while the call was live');
  console.log('keyboard cursor on the line survives the live redraws');
  await page.click('#leave');
  await sleep(2500);

  // 10. Delete with Undo: the row leaves at once, Undo brings it back, a second delete reaches storage after eight seconds.
  await app.bringToFront();
  await app.waitForSelector('[data-act="menu"]', { timeout: 5000 });
  const total = (await sw.evaluate(() => MCC.store.listMeetings())).length;
  await app.click('[data-act="menu"]');
  await app.click('.menu-list [data-act="delete"]');
  await app.waitForSelector('#index .row', { timeout: 3000 });
  if ((await app.$$eval('#index .row', (els) => els.length)) !== total - 1) errors.push('the deleted meeting did not leave the list at once');
  await app.click('#toast button');
  await app.waitForFunction((n) => document.querySelectorAll('#index .row').length === n, total, { timeout: 3000 });
  if ((await sw.evaluate(() => MCC.store.listMeetings())).length !== total) errors.push('Undo did not keep the meeting');
  await app.click('#index .row');
  await app.waitForSelector('[data-act="menu"]', { timeout: 3000 });
  await app.click('[data-act="menu"]');
  await app.click('.menu-list [data-act="delete"]');
  await app.waitForSelector('#index', { timeout: 3000 });
  await sleep(8800);
  const left = (await sw.evaluate(() => MCC.store.listMeetings())).length;
  if (left !== total - 1) errors.push(`the delete did not reach storage after the undo window: ${left} of ${total} meetings remain`);
  console.log('delete with Undo: hidden at once, back on Undo, gone from storage after the eight seconds');

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
