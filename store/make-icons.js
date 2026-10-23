// Renders icons/icon{16,32,48,128}.png and store/store-icon-128x128.png from store/assets/icon.js.
// Run: node store/make-icons.js   (needs Playwright's Chromium)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { iconSvg } = require('./assets/icon');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-icons-'));
  for (const [size, pad, out] of [[16, 0, 'icons/icon16.png'], [32, 1, 'icons/icon32.png'], [48, 2, 'icons/icon48.png'], [128, 12, 'icons/icon128.png']]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const f = path.join(tmp, `${size}.html`);
    fs.writeFileSync(f, `<html><body style="margin:0;background:transparent">${iconSvg(size, pad)}</body></html>`);
    await page.goto('file://' + f);
    await page.screenshot({ path: path.join(ROOT, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log('wrote', out);
  }
  fs.copyFileSync(path.join(ROOT, 'icons/icon128.png'), path.join(__dirname, 'store-icon-128x128.png'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
