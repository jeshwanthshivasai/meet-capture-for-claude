// The extension icon as SVG: an opening quotation mark, set in Newsreader (the face the captures page uses
// for what people said), in mint on a dark tile. The mark is what the extension keeps: the words.
// The outlines come from app/fonts/Newsreader-latin.woff2 (SIL OFL): the display cut (opsz 72, wght 600) for
// 48px and up, the sturdier small-size cut (opsz 6, wght 700) for the toolbar sizes. Font units, y up.
// pad: transparent margin around the 96-unit art (16 for the 128px store icon, less for toolbar sizes).
const MINT = '#4CC9A8';
const DISPLAY = { d: 'M433.1 1414.3Q329 1367 285.8 1314.7Q242.7 1262.4 242.7 1198.4Q242.7 1157.8 266.7 1130.4Q290.6 1103 322.2 1085.6Q353.7 1068.2 377.7 1057.4Q401.6 1046.6 401.6 1039.2Q401.6 971.5 356.7 926.4Q311.8 881.2 240.8 881.2Q165 881.2 116.5 930.2Q68.1 979.1 68.1 1071.6Q68.1 1146.6 103.7 1214.7Q139.3 1282.8 215.6 1342.5Q291.8 1402.2 412.7 1451.1ZM847.7 1414.3Q743.5 1367 700.4 1314.7Q657.3 1262.4 657.3 1198.4Q657.3 1157.8 681.2 1130.4Q705.2 1103 736.7 1085.6Q768.3 1068.2 792.2 1057.4Q816.2 1046.6 816.2 1039.2Q816.2 971.5 771.3 926.4Q726.4 881.2 655.4 881.2Q579.5 881.2 531.1 930.2Q482.7 979.1 482.7 1071.6Q482.7 1146.6 518.3 1214.7Q553.9 1282.8 630.1 1342.5Q706.4 1402.2 827.3 1451.1Z', x0: 68.1, y1: 1451.1, w: 779.5, h: 569.9 };
const SMALL = { d: 'M545.8 1313.2Q438.6 1264.6 403.7 1228Q368.8 1191.5 368.8 1143.5Q368.8 1112.5 390.7 1087.9Q412.6 1063.2 440.7 1042.6Q468.8 1022 490.7 1003.8Q512.6 985.6 512.6 967.3Q512.6 885.8 457.6 830Q402.5 774.1 304.6 774.1Q202.8 774.1 145.5 829.2Q88.3 884.2 88.3 982.7Q88.3 1085.1 123.7 1165.8Q159.2 1246.6 244.9 1313.1Q330.6 1379.6 481.8 1438.7ZM1062.5 1313.2Q955.2 1264.6 920.3 1228Q885.4 1191.5 885.4 1143.5Q885.4 1112.5 907.4 1087.9Q929.3 1063.2 957.3 1042.6Q985.4 1022 1007.3 1003.8Q1029.2 985.6 1029.2 967.3Q1029.2 885.8 974.2 830Q919.2 774.1 821.2 774.1Q719.5 774.1 662.2 829.2Q604.9 884.2 604.9 982.7Q604.9 1085.1 640.4 1165.8Q675.9 1246.6 761.6 1313.1Q847.3 1379.6 998.4 1438.7Z', x0: 88.3, y1: 1438.7, w: 974.2, h: 664.6 };
const r = (v, p = 3) => String(Number(v.toFixed(p)));

/** The “ mark as a path, w wide, its top-left corner at (x, y). Height: w * cut.h / cut.w. */
function quoteMark({ x, y, w, fill = MINT, cut = DISPLAY }) {
  const s = w / cut.w;
  return `<path d="${cut.d}" transform="translate(${r(x)} ${r(y)}) scale(${r(s, 6)} ${r(-s, 6)}) translate(${r(-cut.x0, 1)} ${r(-cut.y1, 1)})" fill="${fill}"/>`;
}

function iconSvg(size, pad) {
  const s = (size - 2 * pad) / 96;
  const rx = (size - 2 * pad) * 0.23;
  const cut = size >= 48 ? DISPLAY : SMALL;
  const w = size >= 48 ? 58 : 64, h = w * cut.h / cut.w;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#222C33"/><stop offset="1" stop-color="#0F1417"/></linearGradient>
  </defs>
  <g transform="translate(${pad} ${pad}) scale(${s})">
    <rect x="0" y="0" width="96" height="96" rx="${r(rx / s)}" fill="url(#tile)"/>
    ${size >= 48 ? '<rect x="0.75" y="0.75" width="94.5" height="94.5" rx="' + r(rx / s - 0.75) + '" fill="none" stroke="#FFFFFF" stroke-opacity=".08" stroke-width="1.5"/>' : ''}
    ${quoteMark({ x: (96 - w) / 2, y: 46 - h / 2, w, cut })}
  </g>
</svg>`;
}
module.exports = { iconSvg, quoteMark, MINT, DISPLAY, SMALL };
