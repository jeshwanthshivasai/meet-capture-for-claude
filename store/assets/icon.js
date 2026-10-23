// The extension icon as SVG, composed from two marks at the user's direction: the Google Meet camera (the six coloured
// pieces of the 2020 mark) with the Claude starburst in a terracotta disc over its lower-right corner, as a badge. No tile,
// no gradient, edge or shadow. Google Meet is a trademark of Google LLC and Claude a trademark of Anthropic, PBC; this
// extension is affiliated with neither (see README). The starburst alone, in one colour, is the button in Meet's bar
// (src/ui.js); the whole composition sits on the promo art.
const TERRACOTTA = '#D97757', CREAM = '#F7F3EC';
const ACCENT = TERRACOTTA; // the accent the promo art and the captures page follow
const r = (v, p = 3) => String(Number(v.toFixed(p)));

// The camera, in a 24-unit box (y from 2.13 to 21.9).
const MEET = [
  ['#E94235', 'M5.53 2.13 0 7.75h5.53z'],
  ['#FFBA00', 'M5.928 2.13v5.62h7.608v3.65l5.47-4.45c-.014-1.22.031-2.25-.025-3.46-.148-1.09-1.287-1.47-2.236-1.36z'],
  ['#00832D', 'M23.1 4.32c-.802.295-1.358.995-2.047 1.49-2.506 2.05-4.982 4.12-7.468 6.19 3.025 2.59 6.04 5.18 9.065 7.76 1.218.671 1.428-.814 1.328-1.64v-13a.828.828 0 0 0-.877-.825z'],
  ['#0066DA', 'M.038 8.15v7.7h5.53v-7.7z'],
  ['#00AC47', 'M13.615 16.25H6.008v5.62c3.864-.006 7.737.011 11.58-.009 1.02-.07 1.618-1.12 1.468-2.07v-2.51l-5.47-4.68v3.65z'],
  ['#2684FC', 'M.038 16.25c.02 1.44-.041 2.88.033 4.31.162.948 1.158 1.43 2.047 1.31h3.464v-5.62z'],
];
// The starburst, in a 24-unit box.
const CLAUDE = 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z';

const camera = (x, y, s) => `<g transform="translate(${r(x)} ${r(y)}) scale(${r(s)})">${MEET.map(([c, d]) => `<path fill="${c}" d="${d}"/>`).join('')}</g>`;
const star = (x, y, s, fill) => `<g transform="translate(${r(x)} ${r(y)}) scale(${r(s)})"><path fill="${fill}" d="${CLAUDE}"/></g>`;

let uid = 0;
/** The composition in a 96-unit box: the camera, 66 wide, and the badge, a disc of radius 21 at (71, 68), with a clear ring of 4 between them. */
function composition() {
  const m = 'badge' + (uid++);
  return `<mask id="${m}"><rect width="96" height="96" fill="#fff"/><circle cx="71" cy="68" r="25" fill="#000"/></mask>
    <g mask="url(#${m})">${camera(2, 16 - 2.13 * 2.75, 2.75)}</g>
    <circle cx="71" cy="68" r="21" fill="${TERRACOTTA}"/>${star(58, 55, 26 / 24, CREAM)}`;
}

/** The composition at a position on other art (fill is ignored: the marks keep their own colours). */
function mark(fill, at) {
  const body = composition();
  return at ? `<g transform="translate(${r(at.x)} ${r(at.y)}) scale(${r(at.size / 96, 5)})">${body}</g>` : body;
}

/** The starburst in currentColor on a 24-unit grid, for the button in Meet's bar. */
const barGlyph = () => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="${CLAUDE}"/></svg>`;

function iconSvg(size, pad = 0) {
  const s = (size - 2 * pad) / 96;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${pad} ${pad}) scale(${r(s, 5)})">${composition()}</g>
</svg>`;
}
module.exports = { iconSvg, mark, barGlyph, ACCENT, TERRACOTTA, CREAM, MEET, CLAUDE };
