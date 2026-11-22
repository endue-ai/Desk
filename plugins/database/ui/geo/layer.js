// A spatial column read whole (PG-46): one shape per row that holds a value, with its box, its
// simplified runs cached per zoom level (a level is a power of two of pixels per unit), what could
// not be read and why, and the curves left for the viewer's own statement. Which shape is under a
// point. The map's worker holds layers (geo/engine.js). Pure.

import { readGeoJson } from "./geojson.js";
import { boundsOf, isUnread, union } from "./geometry.js";
import { readValue } from "./read.js";
import { simplify } from "./simplify.js";

/**
 * @typedef {import("./geometry.js").Geometry} Geometry
 * @typedef {import("./geometry.js").Bounds} Bounds
 * @typedef {import("./detect.js").Kind} Kind
 * @typedef {{ lines: Float64Array[], polygons: Float64Array[][] }} Simple
 * @typedef {{ row: number, g: Geometry, box: Bounds, levels: Map<number, Simple> }} Shape
 * @typedef {{
 *   shapes: Shape[], bounds: Bounds | null, unread: Array<{ row: number, type: string, srid: number }>,
 *   failed: Array<{ row: number, message: string }>, rows: number,
 * }} Layer
 * @typedef {{
 *   rows: number, shapes: number, vertices: number, srid: number, srids: number, bounds: Bounds | null,
 *   types: Record<string, number>, unread: Array<{ row: number, type: string }>,
 *   failed: number, why: string, first: { type: string, srid: number, vertices: number, z: boolean, m: boolean, radius?: number } | null,
 * }} Summary
 */

/** A layer of a column's values (null: no value in that row). */
export function buildLayer(/** @type {(string | null)[]} */ values, /** @type {Kind} */ kind) {
  /** @type {Layer} */
  const layer = { shapes: [], bounds: null, unread: [], failed: [], rows: values.length };
  values.forEach((value, row) => {
    if (value === null || value === undefined) return;
    try {
      const read = readValue(value, kind);
      if (isUnread(read)) {
        const { unread, srid } = /** @type {import("./geometry.js").Unread} */ (read);
        layer.unread.push({ row, type: unread, srid });
      } else add(layer, row, /** @type {Geometry} */ (read));
    } catch (error) {
      layer.failed.push({ row, message: error instanceof Error ? error.message : String(error) });
    }
  });
  return layer;
}

function add(/** @type {Layer} */ layer, /** @type {number} */ row, /** @type {Geometry} */ g) {
  const box = boundsOf(g);
  if (!box) return;
  layer.shapes.push({ row, g, box, levels: new Map() });
  layer.bounds = union(layer.bounds, box);
}

/**
 * The curves the server read as GeoJSON (the viewer's own statement), in the place of their rows;
 * a text that does not read counts as failed.
 * @param {Layer} layer
 * @param {number[]} rows
 * @param {(string | null)[]} texts
 */
export function readBack(layer, rows, texts) {
  rows.forEach((row, i) => {
    const at = layer.unread.findIndex((u) => u.row === row);
    if (at < 0) return;
    const [{ srid } = { srid: 0 }] = layer.unread.splice(at, 1);
    const text = texts[i];
    try {
      if (text === null || text === undefined) throw new Error("The server read no shape.");
      const g = readGeoJson(text);
      g.srid = srid;
      add(layer, row, g);
    } catch (error) {
      layer.failed.push({ row, message: error instanceof Error ? error.message : String(error) });
    }
  });
  layer.shapes.sort((a, b) => a.row - b.row);
}

/** What a layer holds, for the map's bar and the value viewer. */
export function summaryOf(/** @type {Layer} */ layer) {
  /** @type {Record<string, number>} */
  const types = {};
  /** @type {Map<number, number>} */
  const srids = new Map();
  let vertices = 0;
  for (const { g } of layer.shapes) {
    types[g.type] = (types[g.type] ?? 0) + 1;
    srids.set(g.srid, (srids.get(g.srid) ?? 0) + 1);
    vertices += g.vertices;
  }
  const srid = [...srids].sort((a, b) => b[1] - a[1])[0]?.[0] ?? layer.unread[0]?.srid ?? 0;
  const g = layer.shapes[0]?.g;
  /** @type {Summary} */
  const summary = {
    rows: layer.rows,
    shapes: layer.shapes.length,
    vertices,
    srid,
    srids: srids.size,
    bounds: layer.bounds,
    types,
    unread: layer.unread.map(({ row, type }) => ({ row, type })),
    failed: layer.failed.length,
    why: layer.failed[0]?.message ?? "",
    first: g
      ? {
          type: g.type,
          srid: g.srid,
          vertices: g.vertices,
          z: g.z,
          m: g.m,
          ...(g.radius === undefined ? {} : { radius: g.radius }),
        }
      : null,
  };
  return summary;
}

/** The type, SRID and vertex count of a row's shape; null for a row with none. */
export function factsOf(/** @type {Layer} */ layer, /** @type {number} */ row) {
  const g = layer.shapes.find((s) => s.row === row)?.g;
  return g ? { type: g.type, srid: g.srid, vertices: g.vertices, z: g.z, m: g.m } : null;
}

/** The row of the next (`delta` 1) or previous (-1) shape after row `from`, round the end; -1 for none. */
export function stepFrom(
  /** @type {Layer} */ layer,
  /** @type {number} */ from,
  /** @type {number} */ delta,
  /** @type {Set<number> | null} */ subset,
) {
  const rows = layer.shapes.map((s) => s.row).filter((row) => !subset || subset.has(row));
  if (rows.length === 0) return -1;
  const at = rows.findIndex((row) => (delta > 0 ? row > from : row >= from));
  if (delta > 0) return rows[Math.max(at, 0)] ?? -1;
  const before = at < 0 ? rows.length - 1 : at - 1;
  return rows[before < 0 ? rows.length - 1 : before] ?? -1;
}

/** The box around the shapes of some rows (null: every row); null when none has a shape. */
export function boundsOfRows(/** @type {Layer} */ layer, /** @type {Set<number> | null} */ subset) {
  if (!subset) return layer.bounds;
  /** @type {Bounds | null} */
  let box = null;
  for (const shape of layer.shapes) if (subset.has(shape.row)) box = union(box, shape.box);
  return box;
}

/** A shape's runs simplified for `scale` pixels per unit, cached by its power of two. */
export function simpleOf(/** @type {Shape} */ shape, /** @type {number} */ scale) {
  const level = Math.floor(Math.log2(scale));
  let simple = shape.levels.get(level);
  if (!simple) {
    const tolerance = 0.5 / 2 ** level;
    simple = {
      lines: shape.g.lines.map((line) => simplify(line, tolerance)),
      polygons: shape.g.polygons.map((rings) => rings.map((ring) => simplify(ring, tolerance))),
    };
    shape.levels.set(level, simple);
  }
  return simple;
}

/**
 * The row of the shape under (x, y), the last drawn of those within `tolerance` (an area holds the
 * point, a line or a point is that close); -1 when none is. `subset` limits it to those rows.
 * @param {Layer} layer
 * @param {number} x
 * @param {number} y
 * @param {number} tolerance in y units
 * @param {number} kx how much narrower an x unit is
 * @param {Set<number> | null} subset
 */
export function pickAt(layer, x, y, tolerance, kx = 1, subset = null) {
  let found = -1;
  const tx = tolerance / kx;
  for (const shape of layer.shapes) {
    if (subset && !subset.has(shape.row)) continue;
    const [x0, y0, x1, y1] = shape.box;
    if (x < x0 - tx || x > x1 + tx || y < y0 - tolerance || y > y1 + tolerance) continue;
    if (hits(shape.g, x, y, tolerance, kx)) found = shape.row;
  }
  return found;
}

function hits(
  /** @type {Geometry} */ g,
  /** @type {number} */ x,
  /** @type {number} */ y,
  /** @type {number} */ t,
  /** @type {number} */ kx,
) {
  const t2 = t * t;
  const near = (/** @type {number} */ px, /** @type {number} */ py) =>
    ((px - x) * kx) ** 2 + (py - y) ** 2 <= t2;
  for (let i = 0; i + 1 < g.points.length; i += 2)
    if (near(/** @type {number} */ (g.points[i]), /** @type {number} */ (g.points[i + 1])))
      return true;
  for (const polygon of g.polygons) {
    let inside = false;
    for (const ring of polygon) {
      if (lineNear(ring, x, y, t2, kx)) return true;
      if (contains(ring, x, y)) inside = !inside;
    }
    if (inside) return true;
  }
  for (const line of g.lines) if (lineNear(line, x, y, t2, kx)) return true;
  return false;
}

/** Whether a ring holds a point (even-odd). */
function contains(
  /** @type {Float64Array} */ ring,
  /** @type {number} */ x,
  /** @type {number} */ y,
) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = /** @type {number} */ (ring[i]);
    const yi = /** @type {number} */ (ring[i + 1]);
    const xj = /** @type {number} */ (ring[j]);
    const yj = /** @type {number} */ (ring[j + 1]);
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a run passes within the tolerance of a point. */
function lineNear(
  /** @type {Float64Array} */ run,
  /** @type {number} */ x,
  /** @type {number} */ y,
  /** @type {number} */ t2,
  /** @type {number} */ kx,
) {
  for (let i = 0; i + 3 < run.length; i += 2) {
    const ax = /** @type {number} */ (run[i]) * kx;
    const ay = /** @type {number} */ (run[i + 1]);
    const dx = /** @type {number} */ (run[i + 2]) * kx - ax;
    const dy = /** @type {number} */ (run[i + 3]) - ay;
    const len = dx * dx + dy * dy;
    const u = len ? Math.max(0, Math.min(1, ((x * kx - ax) * dx + (y - ay) * dy) / len)) : 0;
    if ((ax + dx * u - x * kx) ** 2 + (ay + dy * u - y) ** 2 <= t2) return true;
  }
  return false;
}
