// Drawing a layer on a 2D context (PG-46), in the map's worker on an OffscreenCanvas (or in the
// frame when there is no worker): the graticule and its labels first, then the shapes a colour at
// a time (one path per colour for areas, lines and points, so tens of thousands of shapes are a few
// dozen calls), each simplified to its zoom level and left out when out of view, one smaller than
// a pixel drawn as a dot; the picked row last, in the accent colour. Pure but for the context.

import { simpleOf } from "./layer.js";
import { fixed, gridStep, round125, toData } from "./plane.js";

/**
 * @typedef {import("./layer.js").Layer} Layer
 * @typedef {import("./layer.js").Shape} Shape
 * @typedef {import("./plane.js").View} View
 * @typedef {import("./plane.js").Units} Units
 * @typedef {{
 *   width: number, height: number, colors: string[], accent: string, grid: string, label: string,
 *   font: string, picked: number, subset: number[] | null, units: Units,
 * }} Style
 *   `colors` by row number in turn; `subset` the rows to draw (null: every one); `picked` -1 for none.
 * @typedef {{ shapes: number, dots: number, vertices: number }} Drawn
 * @typedef {Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "lineTo" | "closePath" | "rect" | "fill" | "stroke" | "fillText" | "clearRect" | "save" | "restore"> & { fillStyle: unknown, strokeStyle: unknown, lineWidth: number, globalAlpha: number, font: string, lineJoin: string }} Context
 */

const POINT = 5;
const AREA_ALPHA = 0.3;

/**
 * @param {Context} ctx
 * @param {Layer} layer
 * @param {View} v
 * @param {Style} style
 * @returns {Drawn}
 */
export function drawLayer(ctx, layer, v, style) {
  const { width: w, height: h, colors } = style;
  ctx.clearRect(0, 0, w, h);
  graticule(ctx, v, style);
  const subset = style.subset ? new Set(style.subset) : null;
  const [vx0, vy1] = toData(v, 0, 0, w, h);
  const [vx1, vy0] = toData(v, w, h, w, h);
  const ax = v.scale * v.kx;
  const ox = w / 2 - v.cx * ax;
  const oy = h / 2 + v.cy * v.scale;
  /** @type {Shape[][]} */
  const buckets = colors.map(() => []);
  /** @type {Shape | undefined} */
  let picked;
  const drawn = { shapes: 0, dots: 0, vertices: 0 };
  for (const shape of layer.shapes) {
    if (subset && !subset.has(shape.row)) continue;
    const [x0, y0, x1, y1] = shape.box;
    if (x1 < vx0 || x0 > vx1 || y1 < vy0 || y0 > vy1) continue;
    if (shape.row === style.picked) picked = shape;
    else buckets[shape.row % colors.length]?.push(shape);
    drawn.shapes++;
  }
  ctx.lineJoin = "round";
  /** Every shape of a list into one path each for areas, lines and points. */
  const paint = (/** @type {Shape[]} */ shapes, /** @type {string} */ color, wide = false) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = wide ? 2.5 : 1;
    ctx.beginPath();
    let areas = 0;
    for (const shape of shapes) {
      if (tiny(shape, ax, v.scale) || !shape.g.polygons.length) continue;
      for (const rings of simpleOf(shape, v.scale).polygons)
        for (const ring of rings) {
          trace(ring, ax, ox, v.scale, oy);
          ctx.closePath();
          drawn.vertices += ring.length / 2;
          areas++;
        }
    }
    if (areas) {
      ctx.globalAlpha = AREA_ALPHA;
      ctx.fill("evenodd");
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    let lines = 0;
    for (const shape of shapes) {
      if (tiny(shape, ax, v.scale)) continue;
      for (const line of simpleOf(shape, v.scale).lines) {
        trace(line, ax, ox, v.scale, oy);
        drawn.vertices += line.length / 2;
        lines++;
      }
    }
    if (lines) ctx.stroke();
    ctx.beginPath();
    let dots = 0;
    const size = wide ? POINT + 2 : POINT;
    for (const shape of shapes) {
      if (tiny(shape, ax, v.scale)) {
        const [x0, y0, x1, y1] = shape.box;
        ctx.rect(ox + ((x0 + x1) / 2) * ax - 1, oy - ((y0 + y1) / 2) * v.scale - 1, 2, 2);
        drawn.dots++;
        dots++;
        continue;
      }
      const p = shape.g.points;
      for (let i = 0; i + 1 < p.length; i += 2) {
        const sx = ox + /** @type {number} */ (p[i]) * ax;
        const sy = oy - /** @type {number} */ (p[i + 1]) * v.scale;
        ctx.rect(sx - size / 2, sy - size / 2, size, size);
        drawn.vertices++;
        dots++;
      }
    }
    if (dots) ctx.fill();
  };
  /** One run as a path's moves and lines, in screen pixels. */
  const trace = (
    /** @type {Float64Array} */ run,
    /** @type {number} */ sx,
    /** @type {number} */ x0,
    /** @type {number} */ sy,
    /** @type {number} */ y0,
  ) => {
    ctx.moveTo(x0 + /** @type {number} */ (run[0]) * sx, y0 - /** @type {number} */ (run[1]) * sy);
    for (let i = 2; i + 1 < run.length; i += 2)
      ctx.lineTo(
        x0 + /** @type {number} */ (run[i]) * sx,
        y0 - /** @type {number} */ (run[i + 1]) * sy,
      );
  };
  buckets.forEach((shapes, k) => {
    if (shapes.length) paint(shapes, /** @type {string} */ (colors[k]));
  });
  if (picked) paint([picked], style.accent, true);
  return drawn;
}

/** Whether a shape is under a pixel and a half across on screen (and not a point). */
function tiny(/** @type {Shape} */ shape, /** @type {number} */ ax, /** @type {number} */ ay) {
  const [x0, y0, x1, y1] = shape.box;
  return (x1 - x0) * ax < 1.5 && (y1 - y0) * ay < 1.5 && shape.g.points.length === 0;
}

/** The graticule: lines at a round step in the data's units, labelled along the top and left. */
function graticule(/** @type {Context} */ ctx, /** @type {View} */ v, /** @type {Style} */ style) {
  const { width: w, height: h } = style;
  const ax = v.scale * v.kx;
  const step = gridStep(v);
  const stepX = round125(80 / ax, true);
  const [x0, y1] = toData(v, 0, 0, w, h);
  const [x1, y0] = toData(v, w, h, w, h);
  const xs = [];
  const ys = [];
  for (let i = Math.ceil(x0 / stepX); i * stepX <= x1 && xs.length < 200; i++) xs.push(i * stepX);
  for (let i = Math.ceil(y0 / step); i * step <= y1 && ys.length < 200; i++) ys.push(i * step);
  ctx.strokeStyle = style.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of xs) {
    const sx = Math.round(w / 2 + (x - v.cx) * ax) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  for (const y of ys) {
    const sy = Math.round(h / 2 - (y - v.cy) * v.scale) + 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();
  ctx.fillStyle = style.label;
  ctx.font = style.font;
  const mark = style.units === "degrees" ? "°" : "";
  for (const x of xs) ctx.fillText(`${fixed(x, stepX)}${mark}`, w / 2 + (x - v.cx) * ax + 3, 12);
  for (const y of ys) ctx.fillText(`${fixed(y, step)}${mark}`, 3, h / 2 - (y - v.cy) * v.scale - 3);
}
