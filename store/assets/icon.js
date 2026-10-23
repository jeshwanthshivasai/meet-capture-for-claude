// The extension icon as SVG: a capture mark, four viewfinder corners around a solid dot, in white on an
// emerald tile. The corners frame a screen, the dot takes the picture: what the extension does. The tile
// is a diagonal gradient with a sheen at the top and a thin dark edge, so it holds its own among the other
// icons in Chrome's toolbar at 16px, on light and dark. The same mark, in one colour, is the button in
// Meet's bar (src/ui.js) and sits on the promo art. Everything is drawn in a 96-unit box.
// pad: transparent margin around the art (12 for the 128px store icon, less for the toolbar sizes).
const TILE = ['#3EE6A2', '#17B57E', '#0B8A5E']; // emerald, top-left to bottom-right
const MINT = '#4CC9A8'; // the accent the promo art uses
const r = (v, p = 2) => String(Number(v.toFixed(p)));

/** The capture mark in one colour, drawn in a 96-unit box; `at` scales and moves it (x, y, size). */
function captureMark(fill, at) {
  const L = 18, i = 14, sw = 12; // arm length, inset from the box, stroke
  const corner = (x, y, dx, dy) => `<path d="M${x} ${y + dy * L} V${y} H${x + dx * L}" fill="none" stroke="${fill}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const body = corner(i, i, 1, 1) + corner(96 - i, i, -1, 1) + corner(i, 96 - i, 1, -1) + corner(96 - i, 96 - i, -1, -1) + `<circle cx="48" cy="48" r="17" fill="${fill}"/>`;
  return at ? `<g transform="translate(${r(at.x)} ${r(at.y)}) scale(${r(at.size / 96, 5)})">${body}</g>` : body;
}

function iconSvg(size, pad) {
  const s = (size - 2 * pad) / 96, rx = 22;
  const fine = size >= 32; // the sheen, the inner edge and the mark's shadow, only where a pixel can show them
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${TILE[0]}"/><stop offset=".55" stop-color="${TILE[1]}"/><stop offset="1" stop-color="${TILE[2]}"/></linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".22"/><stop offset=".55" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
  </defs>
  <g transform="translate(${pad} ${pad}) scale(${r(s, 5)})">
    <rect width="96" height="96" rx="${rx}" fill="url(#tile)"/>
    ${fine ? `<rect width="96" height="96" rx="${rx}" fill="url(#sheen)"/><rect x="1.25" y="1.25" width="93.5" height="93.5" rx="${rx - 1.25}" fill="none" stroke="#FFFFFF" stroke-opacity=".25" stroke-width="1.5"/>` : ''}
    <rect x="0.5" y="0.5" width="95" height="95" rx="${rx - 0.5}" fill="none" stroke="#000000" stroke-opacity=".3" stroke-width="1"/>
    ${fine ? `<g opacity=".22" transform="translate(0 2.5)">${captureMark('#000000')}</g>` : ''}
    ${captureMark('#FFFFFF')}
  </g>
</svg>`;
}
module.exports = { iconSvg, captureMark, MINT, TILE };
