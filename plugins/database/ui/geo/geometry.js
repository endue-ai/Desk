// One geometry as every reader gives it (PG-46): its type, SRID and dimensions, and its positions
// flattened to x,y runs for drawing: the points, the lines and the polygons' rings. `vertices`
// counts positions as ST_NPoints does (a ring's closing point too). A curve the readers do not draw
// comes back unread, by its type, for the viewer's own statement to read (features/geo/). Pure.

/**
 * @typedef {{
 *   type: string, srid: number, z: boolean, m: boolean, points: number[], lines: Float64Array[],
 *   polygons: Float64Array[][], vertices: number, radius?: number,
 * }} Geometry
 *   `points` x,y pairs; each line one x,y run; each polygon its rings (the first the outer one).
 *   `srid` 0 when the value names none.
 * @typedef {{ unread: string, srid: number }} Unread
 *   A value of a type the readers do not draw (a circular string, a curve polygon...).
 * @typedef {[number, number, number, number]} Bounds minimum x, minimum y, maximum x, maximum y.
 */

/** A geometry with no positions yet. */
export function geometry(
  /** @type {string} */ type,
  /** @type {number} */ srid = 0,
  z = false,
  m = false,
) {
  /** @type {Geometry} */
  const made = { type, srid, z, m, points: [], lines: [], polygons: [], vertices: 0 };
  return made;
}

/** Move `part`'s positions into `into` (a member of a multi type or a collection). */
export function absorb(/** @type {Geometry} */ into, /** @type {Geometry} */ part) {
  for (const value of part.points) into.points.push(value);
  for (const line of part.lines) into.lines.push(line);
  for (const polygon of part.polygons) into.polygons.push(polygon);
  into.vertices += part.vertices;
}

/** Whether a reader's answer is a curve to read on the server. */
export const isUnread = (/** @type {Geometry | Unread} */ g) => "unread" in g;

/** The box around a geometry's positions; null for an empty one. */
export function boundsOf(/** @type {Geometry} */ g) {
  /** @type {Bounds} */
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const take = (/** @type {ArrayLike<number>} */ run) => {
    for (let i = 0; i + 1 < run.length; i += 2) {
      const x = /** @type {number} */ (run[i]);
      const y = /** @type {number} */ (run[i + 1]);
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
  };
  take(g.points);
  for (const line of g.lines) take(line);
  for (const polygon of g.polygons) for (const ring of polygon) take(ring);
  return b[0] <= b[2] ? b : null;
}

/** Two boxes as one; either may be null. */
export function union(/** @type {Bounds | null} */ a, /** @type {Bounds | null} */ b) {
  if (!a) return b;
  if (!b) return a;
  /** @type {Bounds} */
  const both = [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
  return both;
}

/** The type as the value viewer says it: `Polygon`, `Point Z`, `LineString ZM`. */
export function typeName(/** @type {Geometry} */ g) {
  const dims = g.z && g.m ? " ZM" : g.z ? " Z" : g.m ? " M" : "";
  return `${g.type}${dims}`;
}
