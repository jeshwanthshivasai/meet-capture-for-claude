// The extension icon as SVG, flat: a screen with a caption line, in white on a solid emerald tile. One shape,
// no gradient, edge or shadow, in the manner of the Meet and Claude icons: a solid tile, one light glyph,
// room around it. The same screen-with-caption, as an outline, is the button in Meet's bar (src/ui.js), and
// in one colour it sits on the promo art. The glyph is drawn in a 96-unit box; the 16 and 32 px icons are
// drawn by hand on the pixel grid so their edges stay crisp in the toolbar.
const EMERALD = '#10B981';
const MINT = '#4CC9A8'; // the accent the promo art uses
const r = (v, p = 2) => String(Number(v.toFixed(p)));

/** The glyph in one colour in a 96-unit box: a rounded screen with a caption pill knocked out of its lower part. */
function screenMark(fill, at) {
  const body = `<path fill="${fill}" fill-rule="evenodd" d="M22 12 H74 A14 14 0 0 1 88 26 V70 A14 14 0 0 1 74 84 H22 A14 14 0 0 1 8 70 V26 A14 14 0 0 1 22 12 Z M30 59 A5.5 5.5 0 0 0 30 70 H66 A5.5 5.5 0 0 0 66 59 Z"/>`;
  return at ? `<g transform="translate(${r(at.x)} ${r(at.y)}) scale(${r(at.size / 96, 5)})">${body}</g>` : body;
}

// Hand-placed geometry for the toolbar sizes: [tile radius, screen x y w h radius, caption x y w h]
const HINTED = {
  16: { rx: 4, screen: [3, 4, 10, 8, 2], bar: [5.5, 9, 5, 1.5] },
  32: { rx: 7, screen: [6, 8, 20, 16, 4], bar: [11, 18, 10, 3] },
};

function iconSvg(size, pad = 0) {
  const h = HINTED[size];
  if (h && !pad) {
    const [sx, sy, sw, sh, sr] = h.screen, [bx, by, bw, bh] = h.bar;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${h.rx}" fill="${EMERALD}"/>
  <path fill="#FFFFFF" fill-rule="evenodd" d="M${sx + sr} ${sy} H${sx + sw - sr} A${sr} ${sr} 0 0 1 ${sx + sw} ${sy + sr} V${sy + sh - sr} A${sr} ${sr} 0 0 1 ${sx + sw - sr} ${sy + sh} H${sx + sr} A${sr} ${sr} 0 0 1 ${sx} ${sy + sh - sr} V${sy + sr} A${sr} ${sr} 0 0 1 ${sx + sr} ${sy} Z M${bx + bh / 2} ${by} A${bh / 2} ${bh / 2} 0 0 0 ${bx + bh / 2} ${by + bh} H${bx + bw - bh / 2} A${bh / 2} ${bh / 2} 0 0 0 ${bx + bw - bh / 2} ${by} Z"/>
</svg>`;
  }
  const s = (size - 2 * pad) / 96, rx = 21, scale = 0.72, off = 48 - 48 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${pad} ${pad}) scale(${r(s, 5)})">
    <rect width="96" height="96" rx="${rx}" fill="${EMERALD}"/>
    <g transform="translate(${r(off)} ${r(off)}) scale(${scale})">${screenMark('#FFFFFF')}</g>
  </g>
</svg>`;
}
module.exports = { iconSvg, screenMark, MINT, EMERALD };
