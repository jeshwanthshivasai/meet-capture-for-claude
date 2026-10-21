// The extension icon as SVG: a caption bubble with a camera lens on a dark tile.
// pad: transparent margin around the 96-unit art (16 for the 128px store icon, less for toolbar sizes).
function iconSvg(size, pad) {
  const s = (size - 2 * pad) / 96;
  const r = (size - 2 * pad) * 0.23;
  const detail = size >= 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1F282E"/><stop offset="1" stop-color="#0F1417"/></linearGradient>
  </defs>
  <g transform="translate(${pad} ${pad}) scale(${s})">
    <rect x="0" y="0" width="96" height="96" rx="${r / s}" fill="url(#tile)"/>
    ${detail ? '<rect x="0.75" y="0.75" width="94.5" height="94.5" rx="' + (r / s - 0.75) + '" fill="none" stroke="#FFFFFF" stroke-opacity=".09" stroke-width="1.5"/>' : ''}
    <path d="M22 22h52a8 8 0 0 1 8 8v26a8 8 0 0 1-8 8H44l-14 11v-11h-8a8 8 0 0 1-8-8V30a8 8 0 0 1 8-8z" fill="#F4F7F5"/>
    ${size >= 16 ? `<rect x="30" y="34" width="36" height="${detail ? 5.5 : 7}" rx="${detail ? 2.75 : 3.5}" fill="#12161A"/>` : ''}
    ${detail ? '<rect x="30" y="45" width="24" height="5.5" rx="2.75" fill="#12161A"/>' : ''}
    <circle cx="70" cy="68" r="${detail ? 11 : 13}" fill="#4CC9A8"/>
    <circle cx="70" cy="68" r="${detail ? 4.5 : 6}" fill="#12161A"/>
    ${detail ? '<circle cx="74" cy="64" r="1.6" fill="#F4F7F5" fill-opacity=".9"/>' : ''}
  </g>
</svg>`;
}
module.exports = { iconSvg };
