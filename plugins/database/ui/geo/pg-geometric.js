// PostgreSQL's own geometric types (PG-46) as their text output: point `(x,y)`, lseg
// `[(x1,y1),(x2,y2)]`, box `(x1,y1),(x2,y2)`, path `[(...),...]` open or `((...),...)` closed,
// polygon `((x,y),...)` and circle `<(x,y),r>`. Their OIDs are fixed (pg_type.dat); line `{A,B,C}`
// is infinite and is not drawn. They have no SRID; a vertex count is the points the text holds (a
// circle's centre), and a circle is drawn as a ring of 64 sides. Pure.

import { geometry } from "./geometry.js";

/** @typedef {import("./geometry.js").Geometry} Geometry */

/** The built-in geometric types by OID. */
export const GEOMETRIC = /** @type {Record<number, string>} */ ({
  600: "point",
  601: "lseg",
  602: "path",
  603: "box",
  604: "polygon",
  718: "circle",
});
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[-+]?Infinity|NaN/gu;
const SIDES = 64;

/** The numbers a text holds, in order. */
const numbers = (/** @type {string} */ text) => (text.match(NUMBER) ?? []).map(Number);

/** A closed ring of the pairs given, its first point repeated at its end when it is not there. */
function closed(/** @type {number[]} */ xy) {
  const n = xy.length;
  const shut = n >= 4 && xy[0] === xy[n - 2] && xy[1] === xy[n - 1];
  return Float64Array.from(shut ? xy : [...xy, xy[0] ?? 0, xy[1] ?? 0]);
}

/**
 * Read one value of a built-in type.
 * @param {string} text
 * @param {string} type One of GEOMETRIC's names.
 * @returns {Geometry}
 */
export function readGeometric(text, type) {
  const values = numbers(text);
  if (values.length < 2 || (type !== "circle" && values.length % 2 !== 0))
    throw new Error(`Not a ${type}: ${text.slice(0, 40)}`);
  const g = geometry(type);
  if (type === "point") {
    g.points.push(values[0] ?? 0, values[1] ?? 0);
    g.vertices = 1;
  } else if (type === "lseg") {
    g.lines.push(Float64Array.from(values.slice(0, 4)));
    g.vertices = 2;
  } else if (type === "box") {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = values;
    g.polygons.push([Float64Array.from([x1, y1, x2, y1, x2, y2, x1, y2, x1, y1])]);
    g.vertices = 2;
  } else if (type === "path") {
    const open = text.trim().startsWith("[");
    g.type = open ? "path (open)" : "path (closed)";
    g.lines.push(open ? Float64Array.from(values) : closed(values));
    g.vertices = values.length / 2;
  } else if (type === "polygon") {
    g.polygons.push([closed(values)]);
    g.vertices = values.length / 2;
  } else if (type === "circle") {
    const [x = 0, y = 0, r = 0] = values;
    const ring = new Float64Array((SIDES + 1) * 2);
    for (let i = 0; i <= SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2;
      ring[i * 2] = x + r * Math.cos(a);
      ring[i * 2 + 1] = y + r * Math.sin(a);
    }
    g.polygons.push([ring]);
    g.vertices = 1;
    g.radius = r;
  } else throw new Error(`Not a geometric type: ${type}.`);
  return g;
}
