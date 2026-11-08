// Shape geometry of OfficeArt shapes ([MS-ODRAW] 2.4.6 MSOSPT and 2.3.6 Geometry): the shape types
// the renderer draws as presets, their adjust values (in 21600ths of the box) converted to the
// presets' own, and freeforms from their vertices and segments as custom paths. No DOM.
import { pointsOf, signed, wordsOf } from "./options.js";

/**
 * @typedef {import("../deck.js").Geometry} Geometry
 * @typedef {import("../deck.js").PathCommand} PathCommand
 * @typedef {import("./options.js").Options} Options
 */

/** MSOSPT values as preset names; the rest are drawn as their box. */
const PRESETS = /** @type {Record<number, string>} */ ({
  1: "rect",
  2: "roundRect",
  3: "ellipse",
  4: "diamond",
  5: "triangle",
  6: "rtTriangle",
  7: "parallelogram",
  9: "hexagon",
  10: "octagon",
  13: "rightArrow",
  14: "rightArrow",
  15: "homePlate",
  20: "line",
  32: "line",
  33: "bentConnector2",
  34: "bentConnector3",
  35: "bentConnector3",
  36: "bentConnector3",
  37: "curvedConnector3",
  38: "curvedConnector3",
  39: "curvedConnector3",
  40: "curvedConnector3",
  55: "chevron",
  56: "pentagon",
  66: "leftArrow",
  67: "downArrow",
  68: "upArrow",
  109: "rect",
  110: "diamond",
  116: "roundRect",
  120: "ellipse",
  176: "roundRect",
});

/** Whether a shape type is a line or connector (drawn without fill). @param {number} type */
export const isLine = (type) => type === 20 || (type >= 32 && type <= 40);

const ADJUST = 0x0147;

/**
 * A shape type's geometry in a box of w x h points.
 * @param {number} type @param {Options} opts @param {number} w @param {number} h @returns {Geometry}
 */
export function geometryOf(type, opts, w, h) {
  const custom = customOf(opts);
  if (custom && (type === 0 || !PRESETS[type])) return custom;
  if (type === 8) return trapezoid(adjust(opts, 0, 5400) / 21600);
  const name = PRESETS[type] ?? "rect";
  const ss = Math.min(w, h) || 1;
  const a = (/** @type {number} */ i, /** @type {number} */ fallback) =>
    adjust(opts, i, fallback) / 21600;
  /** @type {Record<string, number>} */
  const out = {};
  const pct = (/** @type {number} */ v) => Math.round(v * 100000);
  if (type === 2) out.adj = pct(a(0, 3600));
  else if (type === 5) out.adj = pct(a(0, 10800));
  else if (type === 7 || type === 9) out.adj = pct((a(0, 5400) * w) / ss);
  else if (type === 10) out.adj = pct(a(0, 6326));
  else if (type === 13 || type === 14) {
    out.adj1 = pct(1 - 2 * a(1, 5400));
    out.adj2 = pct(((1 - a(0, 16200)) * w) / ss);
  } else if (type === 66) {
    out.adj1 = pct(1 - 2 * a(1, 5400));
    out.adj2 = pct((a(0, 5400) * w) / ss);
  } else if (type === 67) {
    out.adj1 = pct(1 - 2 * a(1, 5400));
    out.adj2 = pct(((1 - a(0, 16200)) * h) / ss);
  } else if (type === 68) {
    out.adj1 = pct(1 - 2 * a(1, 5400));
    out.adj2 = pct((a(0, 5400) * h) / ss);
  } else if (type === 15 || type === 55) out.adj = pct(((1 - a(0, 16200)) * w) / ss);
  else if (type === 34 || type === 35 || type === 36) out.adj1 = pct(a(0, 10800));
  else if (type === 116) out.adj = 50000;
  return { name, adjust: out };
}

/** An adjust value of the shape. @param {Options} opts @param {number} i @param {number} fallback */
const adjust = (opts, i, fallback) => signed(opts, ADJUST + i, fallback);

/** MSOSPT's trapezoid is wide at the top, the preset's at the bottom: a path of its own. */
function trapezoid(/** @type {number} */ inset) {
  const x = Math.max(0, Math.min(0.5, inset)) * 21600;
  /** @type {PathCommand[]} */
  const commands = [
    { cmd: "M", x: 0, y: 0 },
    { cmd: "L", x: 21600, y: 0 },
    { cmd: "L", x: 21600 - x, y: 21600 },
    { cmd: "L", x, y: 21600 },
    { cmd: "Z" },
  ];
  return {
    name: "custom",
    adjust: {},
    paths: [{ w: 21600, h: 21600, fill: true, stroke: true, commands }],
  };
}

/**
 * A freeform's paths from pVertices and pSegmentInfo in the geoLeft..geoRight, geoTop..geoBottom
 * frame (the vertices' own bounds when the frame is empty), or null when it has no vertices.
 * @param {Options} opts @returns {Geometry | null}
 */
export function customOf(opts) {
  const points = pointsOf(opts, 0x0145);
  if (points.length < 2) return null;
  let left = signed(opts, 0x0140);
  let top = signed(opts, 0x0141);
  let right = signed(opts, 0x0142, 21600);
  let bottom = signed(opts, 0x0143, 21600);
  if (right <= left || bottom <= top) {
    left = Math.min(...points.map((p) => p[0]));
    top = Math.min(...points.map((p) => p[1]));
    right = Math.max(...points.map((p) => p[0]));
    bottom = Math.max(...points.map((p) => p[1]));
  }
  const w = right - left || 1;
  const h = bottom - top || 1;
  let next = 0;
  const take = () => {
    const [x = 0, y = 0] = points[Math.min(next++, points.length - 1)] ?? [];
    return { x: x - left, y: y - top };
  };
  const segments = wordsOf(opts, 0x0146);
  /** @type {import("../deck.js").CustomPath[]} */
  const paths = [];
  /** @type {PathCommand[]} */
  let commands = [];
  let fill = true;
  let stroke = true;
  const flush = () => {
    if (commands.length > 1) paths.push({ w, h, fill, stroke, commands });
    commands = [];
    fill = true;
    stroke = true;
  };
  if (segments.length === 0) {
    commands.push({ cmd: "M", ...take() });
    while (next < points.length) commands.push({ cmd: "L", ...take() });
  }
  for (const seg of segments) {
    const kind = seg >>> 13;
    const count = seg & 0x1fff;
    if (kind === 0)
      for (let i = 0; i < Math.max(1, count); i++) commands.push({ cmd: "L", ...take() });
    else if (kind === 1)
      for (let i = 0; i < Math.max(1, count); i++) {
        const [c1, c2, end] = [take(), take(), take()];
        commands.push({ cmd: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: end.x, y: end.y });
      }
    else if (kind === 2) {
      if (commands.length) flush();
      commands.push({ cmd: "M", ...take() });
    } else if (kind === 3) commands.push({ cmd: "Z" });
    else if (kind === 4) flush();
    else if (kind === 5 || kind === 6) {
      const code = (seg >>> 8) & 0x1f;
      if (code === 0x0a) fill = false;
      else if (code === 0x0b) stroke = false;
      // Other escapes (arcs, guides) take their vertices; they are drawn as a line to the last one.
      const vertices = seg & 0xff;
      for (let i = 0; i < vertices; i++) {
        const point = take();
        if (i === vertices - 1 && commands.length) commands.push({ cmd: "L", ...point });
      }
    }
  }
  flush();
  return paths.length ? { name: "custom", adjust: {}, paths } : null;
}
