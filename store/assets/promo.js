// Promo art without text, as the Web Store asks: caption lines flowing into a document, with the icon's
// mark, a screen with a caption, on the shared screen. Same palette as the icon and the panel.
const { mark, ACCENT } = require('./icon'); // the accent follows the icon's starburst
const INK = '#12161A', INK2 = '#1F282E', PAPER = '#F4F7F5', SOFT = '#AEB9BF', LINE = '#2C383F';

function defs(w, h) {
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#26343B"/><stop offset=".55" stop-color="${INK2}"/><stop offset="1" stop-color="#0F1417"/></linearGradient>
    <radialGradient id="glow" cx=".7" cy=".5" r=".6"><stop offset="0" stop-color="${ACCENT}" stop-opacity=".16"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${LINE}" stroke-opacity=".5"/></pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/><rect width="${w}" height="${h}" fill="url(#grid)"/><rect width="${w}" height="${h}" fill="url(#glow)"/>`;
}

/** A caption line: a name chip and a text bar, like the panel's feed. */
function caption(x, y, w, nameW, fill, op = 1) {
  return `<g opacity="${op}"><rect x="${x}" y="${y}" width="${nameW}" height="12" rx="6" fill="${ACCENT}"/><rect x="${x + nameW + 8}" y="${y}" width="${w - nameW - 8}" height="12" rx="6" fill="${fill}"/></g>`;
}

/** The shared screen: a window with a title bar and a slide, with the mark on its corner. */
function screen(x, y, w) {
  const h = w * 0.6;
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.04}" fill="${PAPER}"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h * 0.12}" rx="${w * 0.04}" fill="#DDE3E0"/>
    <rect x="${x}" y="${y + h * 0.06}" width="${w}" height="${h * 0.06}" fill="#DDE3E0"/>
    <circle cx="${x + w * 0.06}" cy="${y + h * 0.06}" r="${w * 0.018}" fill="#E0533E"/><circle cx="${x + w * 0.11}" cy="${y + h * 0.06}" r="${w * 0.018}" fill="#D99A2B"/><circle cx="${x + w * 0.16}" cy="${y + h * 0.06}" r="${w * 0.018}" fill="${ACCENT}"/>
    <rect x="${x + w * 0.1}" y="${y + h * 0.25}" width="${w * 0.5}" height="${h * 0.11}" rx="${h * 0.03}" fill="${INK}"/>
    <rect x="${x + w * 0.1}" y="${y + h * 0.45}" width="${w * 0.75}" height="${h * 0.06}" rx="${h * 0.03}" fill="#8A969C"/>
    <rect x="${x + w * 0.1}" y="${y + h * 0.58}" width="${w * 0.6}" height="${h * 0.06}" rx="${h * 0.03}" fill="#8A969C"/>
    <rect x="${x + w * 0.1}" y="${y + h * 0.74}" width="${w * 0.35}" height="${h * 0.14}" rx="${h * 0.03}" fill="${ACCENT}"/>
    ${mark(ACCENT, { x: x + w * 0.78, y: y + h * 0.7, size: w * 0.16 })}
  </g>`;
}

/** The document the call turns into: a page with a title, a snapshot thumbnail and caption lines. */
function doc(x, y, w) {
  const h = w * 1.3;
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(caption(x + w * 0.1, y + h * 0.42 + i * h * 0.1, w * 0.8, w * (i % 2 ? 0.16 : 0.22), i === 2 ? '#C9D2CE' : '#DDE3E0'));
  return `<g>
    <rect x="${x + 6}" y="${y + 8}" width="${w}" height="${h}" rx="${w * 0.05}" fill="${INK}" fill-opacity=".45"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.05}" fill="${PAPER}"/>
    <rect x="${x + w * 0.1}" y="${y + h * 0.09}" width="${w * 0.55}" height="${h * 0.06}" rx="${h * 0.02}" fill="${INK}"/>
    <rect x="${x + w * 0.1}" y="${y + h * 0.19}" width="${w * 0.8}" height="${h * 0.03}" rx="${h * 0.015}" fill="#C9D2CE"/>
    <rect x="${x + w * 0.1}" y="${y + h * 0.26}" width="${w * 0.3}" height="${h * 0.1}" rx="${h * 0.02}" fill="${ACCENT}" fill-opacity=".35" stroke="${ACCENT}" stroke-width="2"/>
    ${rows.join('')}
  </g>`;
}

function promoTile() { // 440x280
  const W = 440, H = 280;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs(W, H)}
    ${screen(28, 40, 230)}
    ${caption(40, 196, 190, 46, '#DDE3E0', 1)}${caption(40, 218, 170, 36, '#DDE3E0', .8)}${caption(40, 240, 200, 52, '#DDE3E0', .6)}
    <path d="M262 150 C 290 150, 290 150, 310 150" fill="none" stroke="${ACCENT}" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>
    <path d="M300 142 l12 8 -12 8z" fill="${ACCENT}"/>
    ${doc(312, 46, 100)}
  </svg>`;
}

function marquee() { // 1400x560
  const W = 1400, H = 560;
  const caps = [];
  for (let i = 0; i < 5; i++) caps.push(caption(110, 366 + i * 32, 480 - (i % 3) * 60, [80, 110, 64][i % 3], '#DDE3E0', 1 - i * 0.14)); // below the screen, not across it
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs(W, H)}
    ${screen(110, 40, 480)}
    ${caps.join('')}
    <path d="M650 280 C 720 280, 720 280, 790 280" fill="none" stroke="${ACCENT}" stroke-width="5" stroke-dasharray="3 14" stroke-linecap="round"/>
    <path d="M778 266 l24 14 -24 14z" fill="${ACCENT}"/>
    ${doc(880, 70, 320)}
  </svg>`;
}

module.exports = { promoTile, marquee };
