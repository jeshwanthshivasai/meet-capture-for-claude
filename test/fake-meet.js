// A fake Google Meet (test/fake-meet.html) served in place of meet.google.com, and a Chromium launcher
// that loads the unpacked extension next to it. Used by test/e2e.js and store/make-assets.js.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const EXT = path.resolve(__dirname, '..');
const PAGE = (code) => fs.readFileSync(path.join(__dirname, 'fake-meet.html'), 'utf8').replace(/{{CODE}}/g, code);

async function launch(opts = {}) {
  const errors = [];
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-profile-'));
  const downloads = opts.downloads || fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-downloads-'));
  // Chrome reads the default download folder from the profile's preferences.
  fs.mkdirSync(path.join(userDir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(userDir, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false }, savefile: { default_directory: downloads } }));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false, viewport: { width: 1280, height: 800 }, deviceScaleFactor: opts.scale || 1, acceptDownloads: true,
    colorScheme: opts.colorScheme || 'light',
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'],
  });
  // The captures page writes into a folder through the File System Access API; a fake directory stands in for Chrome's picker.
  await ctx.addInitScript(() => {
    if (!/^chrome-extension:/.test(location.protocol)) return;
    class FakeFile { constructor(name) { this.name = name; this.kind = 'file'; } async createWritable() { const chunks = []; return { write: async (d) => { chunks.push(d); }, close: async () => { window.__fsFiles.push({ path: this.path, size: chunks.reduce((n, c) => n + (typeof c === 'string' ? c.length : c.byteLength), 0), text: typeof chunks[0] === 'string' ? chunks.join('') : null }); } }; } }
    class FakeDir { constructor(name, path) { this.name = name; this.path = path; this.kind = 'directory'; } async queryPermission() { return 'granted'; } async requestPermission() { return 'granted'; } async getDirectoryHandle(name) { return new FakeDir(name, `${this.path}/${name}`); } async getFileHandle(name) { const f = new FakeFile(name); f.path = `${this.path}/${name}`; return f; } }
    window.__fsFiles = [];
    window.showDirectoryPicker = async () => { window.__fsPicked = (window.__fsPicked || 0) + 1; return new FakeDir('Meet captures', 'Meet captures'); };
  });
  await ctx.route('https://claude.ai/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Claude</title><p>fake claude.ai</p>' }));
  await ctx.route('https://meet.google.com/**', (route) => {
    const code = (new URL(route.request().url()).pathname.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})/) || [])[1] || 'abc-defg-hij';
    return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE(code) });
  });
  // Playwright renames downloads it intercepts; point Chrome at a real folder so the files keep their names.
  const first = ctx.pages()[0] || await ctx.newPage();
  const cdp = await ctx.newCDPSession(first);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }).catch(() => {});
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  return { ctx, sw, extId, errors, downloads, userDir };
}

module.exports = { launch, PAGE, EXT };
