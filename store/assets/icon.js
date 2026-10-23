// The extension icon as SVG, composed from two marks at the user's direction: the Google Meet camera (the yellow mark: the
// body with its one deep corner, the pink light at the lens edge and the viewfinder wing, redrawn as vector from Google's
// artwork, with the white lens dot left out) and the Claude starburst, in Claude's terracotta, centred on the camera's body.
// No tile, no shadow. Google Meet is a trademark of Google LLC and Claude a trademark of Anthropic, PBC; this extension is
// affiliated with neither (see README). The starburst alone, in one colour, is the button in Meet's bar (src/ui.js); the
// whole composition sits on the promo art.
'use strict';
const TERRACOTTA = '#D97757', CREAM = '#F7F3EC';
const ACCENT = TERRACOTTA; // the accent the promo art and the captures page follow
const r = (v, p = 2) => String(Number(v.toFixed(p)));

// Google's artwork is 512 units square; everything below was measured in it.
const BODY = { x0: 20.7, y0: 71.5, x1: 362.3, y1: 439.6, tl: 116, tr: 52, br: 52, bl: 52 }; // the camera body and its corner radii
const WING = { x0: 362, yc: 262, half: 75.4, slope: 0.7045, x1: 490.5, outer: 32, inner: 5 }; // the viewfinder: half-height where it meets the body, flare per unit, corner radii
const GLOW = { cx: 362.5, cy: 262.5, r: 190, color: '#FFBBDA', stops: [1, .97, .87, .72, .57, .38, .235, .128, .056, .012, 0] }; // the pink light: opacity per tenth of the radius
const BODY_FILL = ['#FEC902', '#FEE01A'], WING_FILL = ['#F7A300', '#FBB100']; // left to right
const STAR = { cx: 193, cy: 258, size: 208 }; // the starburst, centred on the body
const BOX = 496, ORIGIN = 8; // the icon's square box inside the artwork: 496 units around its centre (256, 256)

// The starburst, in a 24-unit box.
const CLAUDE = 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z';

const unit = (x, y) => { const l = Math.hypot(x, y); return { x: x / l, y: y / l }; };

/** A rectangle with a radius per corner. */
function roundedRect({ x0, y0, x1, y1, tl, tr, br, bl }) {
  return `M${r(x0 + tl)} ${r(y0)}H${r(x1 - tr)}A${tr} ${tr} 0 0 1 ${r(x1)} ${r(y0 + tr)}V${r(y1 - br)}A${br} ${br} 0 0 1 ${r(x1 - br)} ${r(y1)}H${r(x0 + bl)}A${bl} ${bl} 0 0 1 ${r(x0)} ${r(y1 - bl)}V${r(y0 + tl)}A${tl} ${tl} 0 0 1 ${r(x0 + tl)} ${r(y0)}Z`;
}

/** A convex polygon, clockwise on screen, with a radius at each vertex. */
function roundedPolygon(pts) {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const u = unit(a.x - p.x, a.y - p.y), v = unit(b.x - p.x, b.y - p.y);
    const theta = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y)));
    const t = p.r / Math.tan(theta / 2);
    d += `${i ? 'L' : 'M'}${r(p.x + u.x * t)} ${r(p.y + u.y * t)}A${p.r} ${p.r} 0 0 1 ${r(p.x + v.x * t)} ${r(p.y + v.y * t)}`;
  }
  return d + 'Z';
}

function wingPath() {
  const { x0, yc, half, slope, x1, outer, inner } = WING;
  const h1 = half + slope * (x1 - x0);
  return roundedPolygon([{ x: x0, y: yc - half, r: inner }, { x: x1, y: yc - h1, r: outer }, { x: x1, y: yc + h1, r: outer }, { x: x0, y: yc + half, r: inner }]);
}

const star = (cx, cy, size, fill) => `<g transform="translate(${r(cx - size / 2)} ${r(cy - size / 2)}) scale(${r(size / 24, 4)})"><path fill="${fill}" d="${CLAUDE}"/></g>`;

let uid = 0;
/** The composition in the artwork's 512-unit space: the camera without its dot, the starburst centred on the body. */
function composition() {
  const id = 'mc' + (uid++), body = roundedRect(BODY);
  const stops = GLOW.stops.map((o, i) => `<stop offset="${r(i / (GLOW.stops.length - 1))}" stop-color="${GLOW.color}" stop-opacity="${o}"/>`).join('');
  return `<defs>
    <linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="${BODY.x0}" x2="${BODY.x1}" y1="0" y2="0"><stop offset="0" stop-color="${BODY_FILL[0]}"/><stop offset="1" stop-color="${BODY_FILL[1]}"/></linearGradient>
    <radialGradient id="${id}g" gradientUnits="userSpaceOnUse" cx="${GLOW.cx}" cy="${GLOW.cy}" r="${GLOW.r}">${stops}</radialGradient>
    <linearGradient id="${id}w" gradientUnits="userSpaceOnUse" x1="${WING.x0}" x2="${WING.x1}" y1="0" y2="0"><stop offset="0" stop-color="${WING_FILL[0]}"/><stop offset="1" stop-color="${WING_FILL[1]}"/></linearGradient>
  </defs>
  <path d="${wingPath()}" fill="url(#${id}w)"/>
  <path d="${body}" fill="url(#${id}b)"/><path d="${body}" fill="url(#${id}g)"/>
  ${star(STAR.cx, STAR.cy, STAR.size, TERRACOTTA)}`;
}

/** The composition in a square box of `at.size` at (`at.x`, `at.y`) on other art; `fill` is ignored, the marks keep their colours. */
function mark(fill, at) {
  const body = composition();
  return at ? `<g transform="translate(${r(at.x)} ${r(at.y)}) scale(${r(at.size / BOX, 6)}) translate(${-ORIGIN} ${-ORIGIN})">${body}</g>` : body;
}

/** The starburst in currentColor on a 24-unit grid, for the button in Meet's bar. */
const barGlyph = () => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="${CLAUDE}"/></svg>`;

function iconSvg(size, pad = 0) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${pad} ${pad}) scale(${r((size - 2 * pad) / BOX, 6)}) translate(${-ORIGIN} ${-ORIGIN})">${composition()}</g>
</svg>`;
}
module.exports = { iconSvg, mark, barGlyph, ACCENT, TERRACOTTA, CREAM, CLAUDE, composition };
