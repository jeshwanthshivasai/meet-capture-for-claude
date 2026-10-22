// Builds every Web Store image from the real extension running on the fake Meet (test/fake-meet.js):
//   store/promo-tile-440x280.png, store/marquee-1400x560.png, store/screenshot-{1..4}.png, docs/*.png
// Icons are made by store/make-icons.js. Run: node store/make-assets.js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launch } = require('../test/fake-meet');
const { iconSvg } = require('./assets/icon');
const { promoTile, marquee } = require('./assets/promo');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-assets-'));
const url = (f) => 'file://' + f;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renderHtml(browser, html, w, h, out, transparent = false) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const f = path.join(TMP, path.basename(out) + '.html'); fs.writeFileSync(f, html);
  await page.goto(url(f)); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(150);
  await page.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
}

// One template for all the screenshots, so they read as a set in the carousel. Same palette as the icon.
function shot({ title, sub, layout, art }) {
  const top = layout === 'top';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}html,body{margin:0;width:1280px;height:800px;overflow:hidden}
  body{background:linear-gradient(135deg,#26343B 0%,#1F282E 55%,#0F1417 100%);position:relative;font-family:Inter,"Inter Display",system-ui,sans-serif}
  .grid{position:absolute;inset:0;background-image:linear-gradient(to right,rgba(44,56,63,.45) 1px,transparent 1px),linear-gradient(to bottom,rgba(44,56,63,.45) 1px,transparent 1px);background-size:40px 40px}
  .glow{position:absolute;inset:0;background:radial-gradient(60% 60% at 75% 45%,rgba(76,201,168,.14),transparent 70%)}
  .brand{position:absolute;right:56px;top:40px;display:flex;align-items:center;gap:10px;color:#AEB9BF;font-weight:600;font-size:18px}
  .brand span{color:#F4F7F5}
  .head{position:absolute;left:84px;${top ? 'top:58px;right:84px' : 'top:0;bottom:0;width:430px;display:flex;flex-direction:column;justify-content:center'}}
  h1{margin:0;font-family:"Inter Display",Inter,system-ui,sans-serif;font-weight:600;color:#F4F7F5;font-size:${top ? 50 : 54}px;line-height:1.06;letter-spacing:-.02em;text-wrap:balance;${top ? 'max-width:900px' : ''}}
  p{margin:16px 0 0;color:#AEB9BF;font-size:22px;line-height:1.4;font-weight:500;max-width:${top ? 900 : 400}px}
  .art{position:absolute}
  .frame{border-radius:14px;overflow:hidden;box-shadow:0 40px 80px rgba(3,6,8,.6),0 0 0 1px rgba(255,255,255,.08)}
  .frame img{display:block;width:100%}
  kbd{font:600 .85em Inter,system-ui,sans-serif;color:#F4F7F5;background:#2C383F;border:1px solid #3B4A52;border-radius:6px;padding:1px 7px}
  </style></head><body><div class="grid"></div><div class="glow"></div>
  <div class="brand">${iconSvg(30, 0)}<span>Meet Capture</span>&nbsp;for Claude</div>
  <div class="head"><h1>${title}</h1><p>${sub}</p></div>
  ${art}</body></html>`;
}

// A plain browser window around a captured page.
function frame(img, w, address, extra = '') {
  return `<div class="frame" style="width:${w}px;background:#202124;${extra}">
    <div style="height:40px;display:flex;align-items:center;gap:9px;padding:0 14px;background:#2B2C30">
      <i style="width:11px;height:11px;border-radius:50%;background:#FF5F57"></i><i style="width:11px;height:11px;border-radius:50%;background:#FEBC2E"></i><i style="width:11px;height:11px;border-radius:50%;background:#28C840"></i>
      <span style="margin-left:12px;flex:1;height:26px;border-radius:13px;background:#1D1E21;color:#C8CBD2;font-size:13px;display:flex;align-items:center;padding:0 12px">${address}</span>
      <span style="width:28px;height:28px;border-radius:7px;display:grid;place-items:center;background:rgba(76,201,168,.16);box-shadow:0 0 0 2px rgba(76,201,168,.45)">${iconSvg(20, 0)}</span>
    </div>
    <img src="${url(img)}" style="width:${w}px;display:block">
  </div>`;
}

// The fake Meet is a test fixture; for the pictures its control bar gets real icons and the tiles get
// camera-off avatars and a readable slide. Nothing the extension reads is changed.
const ICON = {
  mic: '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z"/>',
  cam: '<path d="M15 8v8H5V8h10m1-2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4V7a1 1 0 0 0-1-1z"/>',
  cc: '<path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1z"/>',
  present: '<path d="M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18v12zM11 16h2v-4h3l-4-4-4 4h3z"/>',
  end: '<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>',
  info: '<path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"/>',
  people: '<path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>',
  chat: '<path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H5.17L4 17.17V4h16v12z"/>',
  shapes: '<path d="M11 13v8H3v-8h8zm10-1a5 5 0 1 1-10 0 5 5 0 0 1 10 0zM13 2l5 8H8l5-8z"/>',
};
const svgUrl = (p, fill) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${fill}'>${p}</svg>`)}")`;
async function storeLook(page) {
  await page.addStyleTag({ content: `
    .google-symbols{font-size:0}
    .bar button{background-repeat:no-repeat;background-position:center;background-size:24px}
    .bar .mid button:nth-child(1){background-image:${svgUrl(ICON.mic, '#e8eaed')}}
    .bar .mid button:nth-child(2){background-image:${svgUrl(ICON.cam, '#e8eaed')}}
    .bar button#cc{background-image:${svgUrl(ICON.cc, '#e8eaed')}}
    .bar button#cc[aria-pressed="true"]{background-image:${svgUrl(ICON.cc, '#202124')}}
    .bar button#present{background-image:${svgUrl(ICON.present, '#e8eaed')}}
    .bar button#leave{background-image:${svgUrl(ICON.end, '#ffffff')}}
    .bar .right [aria-label="Meeting details"]{background-image:${svgUrl(ICON.info, '#e3e3e3')}}
    .bar .right [aria-label="Show everyone"]{background-image:${svgUrl(ICON.people, '#e3e3e3')}}
    .bar .right [aria-label="Chat with everyone"]{background-image:${svgUrl(ICON.chat, '#e3e3e3')}}
    .bar .right [aria-label="Activities"]{background-image:${svgUrl(ICON.shapes, '#e3e3e3')}}
    .bar .time{color:#e3e3e3}
    .stage .tile .name{font-size:12px}
    .iOzk7{pointer-events:none}
    .ygicle{font-size:17px}
  ` });
  await page.evaluate(() => {
    const stream = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x); setInterval(() => draw(x), 400); return c.captureStream(5); };
    const avatar = (bg, ring, initials, mirror) => (x) => { x.fillStyle = bg; x.fillRect(0, 0, 640, 360); x.fillStyle = ring; x.beginPath(); x.arc(320, 180, 84, 0, 7); x.fill(); x.save(); if (mirror) { x.translate(640, 0); x.scale(-1, 1); } x.fillStyle = '#F4F7F5'; x.font = '600 64px Inter, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(initials, 320, 184); x.restore(); };
    let step = 0; setInterval(() => { step++; }, 5000); // the presenter walks through the rules: a new snapshot each time
    const slide = (x) => {
      x.fillStyle = '#F7F4EC'; x.fillRect(0, 0, 1600, 900);
      x.fillStyle = '#4CC9A8'; x.fillRect(0, 0, 28, 900);
      x.fillStyle = '#12161A'; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
      x.font = '600 84px Inter, system-ui, sans-serif'; x.fillText('Design rules we agreed on', 120, 200);
      x.font = '500 42px Inter, system-ui, sans-serif'; x.fillStyle = '#5F6B72'; x.fillText('Weekly design sync · 22 Oct', 120, 270);
      x.font = '400 46px Inter, system-ui, sans-serif';
      ['Nothing generic: every screen answers one question', 'One accent colour, used for one job', 'Real content in every mock, no lorem ipsum', 'Ship the empty state with the feature'].forEach((t, i) => {
        const on = i === step % 4;
        if (on) { x.fillStyle = '#12161A'; x.beginPath(); x.roundRect(110, 360 + i * 100, 1380, 84, 16); x.fill(); }
        x.fillStyle = on ? '#F4F7F5' : '#4CC9A8'; x.beginPath(); x.arc(150, 400 + i * 100, 12, 0, 7); x.fill();
        x.fillStyle = on ? '#F4F7F5' : '#1A2126'; x.fillText(t, 190, 416 + i * 100);
      });
    };
    const set = (id, s) => { const v = document.getElementById(id); if (v) v.srcObject = s; };
    set('cam2', stream(640, 360, avatar('#2E3F49', '#5B8DB8', 'PN')));
    set('selfcam', stream(640, 360, avatar('#3D3127', '#C98A4B', 'JS', true))); // Meet mirrors your own tile
    const pres = document.getElementById('pres');
    if (pres) pres.srcObject = stream(1600, 900, slide);
  });
}

function mdToHtml(md) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const inline = (s) => esc(s).replace(/\\([\\`*_[\]<>#])/g, '$1').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const out = [];
  for (const line of md.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('# ')) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.startsWith('## ')) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line.startsWith('> ')) out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    else if (/^\d+\. /.test(line)) out.push(`<p class="li">${inline(line)}</p>`);
    else out.push(`<p>${inline(line)}</p>`);
  }
  return out.join('');
}

(async () => {
  const browser = await chromium.launch();

  // ---- promo art (no text)
  await renderHtml(browser, `<html><body style="margin:0">${promoTile()}</body></html>`, 440, 280, path.join(__dirname, 'promo-tile-440x280.png'));
  await renderHtml(browser, `<html><body style="margin:0">${marquee()}</body></html>`, 1400, 560, path.join(__dirname, 'marquee-1400x560.png'));

  // ---- captures from the real extension, at 2x so they stay sharp when placed
  const { ctx, sw } = await launch({ scale: 2 });
  const cap = (n) => path.join(TMP, n + '.png');
  const PANEL = '#meet-capture-panel .panel';
  const inPanel = (body) => new Function(`const h = document.querySelector('#meet-capture-panel'); const panel = h && h.shadowRoot && h.shadowRoot.querySelector('.panel'); if (!panel) return false; ${body}`);
  const page = await ctx.newPage(); await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('https://meet.google.com/abc-defg-hij');
  await page.click('#join');
  await page.waitForSelector(`${PANEL}.open`, { timeout: 8000 });
  await page.waitForSelector('#pres', { timeout: 8000 });
  await storeLook(page);
  await page.waitForFunction(inPanel("return panel.querySelectorAll('.msg').length >= 3 && panel.querySelectorAll('.snap').length >= 2;"), null, { timeout: 25000 });
  await sleep(1500); // a snapshot of the readable slide
  await page.screenshot({ path: cap('meet') });
  await page.screenshot({ path: cap('meet-right'), clip: { x: 540, y: 100, width: 740, height: 700 } });
  await page.waitForFunction(() => window.__fake && window.__fake.done, null, { timeout: 30000 });
  await sleep(1200);
  const appPromise = ctx.waitForEvent('page', { timeout: 15000 });
  await page.click('#leave');
  const app = await appPromise;
  await app.waitForLoadState();
  await page.waitForSelector('#meet-capture-after .card', { timeout: 8000 });
  await sleep(400);
  await page.screenshot({ path: cap('left') });
  await page.screenshot({ path: cap('left-card'), clip: { x: 240, y: 300, width: 800, height: 500 } });
  await app.bringToFront();
  await app.setViewportSize({ width: 1280, height: 800 });
  await app.waitForSelector('.tl .line', { timeout: 15000 });
  await app.waitForFunction(() => !document.querySelector('.meta .live'), null, { timeout: 15000 });
  await app.waitForSelector('.figure img', { timeout: 5000 });
  await app.waitForFunction(() => [...document.querySelectorAll('.figure img')].every((i) => /^blob:/.test(i.src) || i.closest('.figure').getBoundingClientRect().top >= 900), null, { timeout: 5000 }).catch(() => {});
  await app.addStyleTag({ content: '::-webkit-scrollbar{display:none}' });
  await sleep(800);
  await app.screenshot({ path: cap('app') });
  await app.click('#settings-btn'); await app.waitForSelector('#settings-form');
  await app.fill('#s-myName', 'Jesh Shiva');
  await app.fill('#s-preface', 'Summarise the decisions and list action items with owners.');
  await sleep(600); await app.screenshot({ path: cap('app-settings') });
  await app.click('#settings-form .buttons .btn');
  const md = await sw.evaluate(async () => {
    const m = (await MCC.store.listMeetings())[0];
    const { settings } = await chrome.storage.local.get('settings');
    return MCC.buildMarkdown({ meeting: m, lines: await MCC.store.getLines(m.id), snapshots: await MCC.store.getSnapshots(m.id, { withData: false }), settings });
  });
  fs.writeFileSync(path.join(TMP, 'transcript.md'), md);
  await ctx.close();

  // ---- the transcript as a document
  const docHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;width:720px;background:#fff;color:#1A2126;font:17px/1.5 Inter,system-ui,sans-serif;padding:44px 52px}
    h1{font:600 30px/1.15 "Inter Display",Inter,system-ui,sans-serif;margin:0 0 14px;letter-spacing:-.02em}
    h2{font:600 18px/1.2 Inter,system-ui,sans-serif;margin:26px 0 10px;color:#12161A}
    p{margin:0 0 10px}p.li{margin-left:8px}b{color:#0B1F19}
    blockquote{margin:10px 0;padding:8px 12px;border-left:3px solid #4CC9A8;background:#EEF8F4;border-radius:0 8px 8px 0;color:#1F5C4A;font-weight:500}
    .meta{color:#5F6B72;font-size:14px}
  </style></head><body>${mdToHtml(md).replace(/<p>(Google Meet ·)/, '<p class="meta">$1').replace(/<p>(Captured on this computer)/, '<p class="meta">$1')}</body></html>`;
  const dp = await browser.newPage({ viewport: { width: 720, height: 400 }, deviceScaleFactor: 2 });
  fs.writeFileSync(path.join(TMP, 'doc.html'), docHtml);
  await dp.goto(url(path.join(TMP, 'doc.html'))); await dp.evaluate(() => document.fonts.ready); await sleep(150);
  await dp.screenshot({ path: cap('doc'), fullPage: true }); await dp.close();

  // ---- the screenshots
  const S = (n) => path.join(__dirname, `screenshot-${n}.png`);
  await renderHtml(browser, shot({ layout: 'left', title: 'Captures your Meet call, inside Meet',
    sub: 'A button in Meet\u2019s own bar opens a panel like Meet\u2019s own: captions with names and times, snapshots of the shared screen as it changes. No bot, nothing leaves your browser.',
    art: `<div class="art" style="left:600px;top:88px">${frame(cap('meet-right'), 620, 'meet.google.com/abc-defg-hij')}</div>` }), 1280, 800, S(1));
  await renderHtml(browser, shot({ layout: 'top', title: 'The moment you hang up, the meeting is ready for Claude',
    sub: 'Your captures page opens by itself: the transcript with the snapshots in place. Open in Claude, copy, one ZIP, or save straight into a folder.',
    art: `<div class="art" style="left:84px;top:270px">${frame(cap('app'), 1112, 'Meet Capture')}</div>` }), 1280, 800, S(2));
  await renderHtml(browser, shot({ layout: 'left', title: 'Captions become a transcript Claude can read',
    sub: 'Who said what, and when. Your standing note at the top. Snapshot markers between the right lines.',
    art: `<div class="art frame" style="left:560px;top:100px;width:660px;transform:rotate(-1.4deg)"><img src="${url(cap('doc'))}"></div>` }), 1280, 800, S(3));
  await renderHtml(browser, shot({ layout: 'left', title: 'One card when you leave, one click to Claude',
    sub: 'Lines, snapshots and length at a glance. Everything stays on your computer; captured meetings are kept for 30 days.',
    art: `<div class="art" style="left:540px;top:160px">${frame(cap('left-card'), 680, 'meet.google.com/abc-defg-hij')}</div>` }), 1280, 800, S(4));

  // ---- README images
  const docs = path.join(ROOT, 'docs');
  for (const f of fs.readdirSync(docs)) if (/\.png$/.test(f)) fs.unlinkSync(path.join(docs, f));
  for (const [src, dst] of [['meet', 'meet.png'], ['app', 'app.png'], ['left-card', 'card.png'], ['app-settings', 'settings.png']]) fs.copyFileSync(cap(src), path.join(docs, dst));
  await browser.close();
  console.log('assets written; captures in', TMP);
})().catch((e) => { console.error(e); process.exit(1); });
