// Well-known text (PG-46): WKT and the server's EWKT (`SRID=4326;` first, `POINTM` for M, a third
// ordinate read as Z), ISO's `POINT Z (...)`, EMPTY, MULTIPOINT with or without each point's own
// brackets, and collections nested. A curve comes back unread by its type. Pure; the map's worker
// runs it (geo/engine.js).

import { absorb, geometry } from "./geometry.js";

/** @typedef {import("./geometry.js").Geometry} Geometry @typedef {import("./geometry.js").Unread} Unread */

const NAMES = /** @type {Record<string, string>} */ ({
  POINT: "Point",
  LINESTRING: "LineString",
  POLYGON: "Polygon",
  MULTIPOINT: "MultiPoint",
  MULTILINESTRING: "MultiLineString",
  MULTIPOLYGON: "MultiPolygon",
  GEOMETRYCOLLECTION: "GeometryCollection",
  TRIANGLE: "Triangle",
  TIN: "Tin",
  POLYHEDRALSURFACE: "PolyhedralSurface",
  CIRCULARSTRING: "CircularString",
  COMPOUNDCURVE: "CompoundCurve",
  CURVEPOLYGON: "CurvePolygon",
  MULTICURVE: "MultiCurve",
  MULTISURFACE: "MultiSurface",
});
const CURVES = new Set([
  "CircularString",
  "CompoundCurve",
  "CurvePolygon",
  "MultiCurve",
  "MultiSurface",
]);
const TOKEN = /\s*(?:([A-Za-z]+)|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([(),]))/uy;
const START =
  /^\s*(?:SRID=-?\d+;\s*)?(?:POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION|TRIANGLE|TIN|POLYHEDRALSURFACE|CIRCULARSTRING|COMPOUNDCURVE|CURVEPOLYGON|MULTICURVE|MULTISURFACE)\s*(?:ZM|Z|M)?\s*(?:\(|EMPTY\b)/iu;

/** Whether a text starts as WKT or EWKT does: for a column's first values. */
export const looksWkt = (/** @type {string} */ text) => START.test(text);

/**
 * Read one value.
 * @param {string} text
 * @returns {Geometry | Unread}
 */
export function readWkt(text) {
  const prefix = /^\s*SRID=(-?\d+);/iu.exec(text);
  const srid = prefix ? Number(prefix[1]) : 0;
  const source = prefix ? text.slice(prefix[0].length) : text;
  /** @type {Array<{ word?: string, number?: number, mark?: string }>} */
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const start = TOKEN.lastIndex;
    const found = TOKEN.exec(source);
    if (!found) {
      if (/^\s*$/u.test(source.slice(start))) break;
      throw new Error(`Not a geometry: unexpected text at ${start + 1}.`);
    }
    if (found[1]) tokens.push({ word: found[1].toUpperCase() });
    else if (found[2]) tokens.push({ number: Number(found[2]) });
    else tokens.push({ mark: found[3] });
  }
  let at = 0;
  const peek = () => tokens[at];
  const mark = (/** @type {string} */ m) => {
    if (tokens[at]?.mark !== m) throw new Error(`Not a geometry: "${m}" expected.`);
    at++;
  };
  const isMark = (/** @type {string} */ m) => tokens[at]?.mark === m;
  /** Past a comma between items; false at the list's end. */
  const comma = () => {
    if (!isMark(",")) return false;
    at++;
    return true;
  };
  const isEmpty = () => {
    if (peek()?.word !== "EMPTY") return false;
    at++;
    return true;
  };

  /** One geometry's tagged text. @returns {Geometry} */
  const tagged = () => {
    const word = peek()?.word;
    if (!word) throw new Error("Not a geometry: a type name expected.");
    at++;
    let name = NAMES[word];
    let m = false;
    let z = false;
    if (!name && word.endsWith("M") && NAMES[word.slice(0, -1)]) {
      name = NAMES[word.slice(0, -1)];
      m = true;
    }
    if (!name) throw new Error(`Not a geometry: ${word} is not a type.`);
    const dims = peek()?.word;
    if (dims === "Z" || dims === "M" || dims === "ZM") {
      z = dims !== "M";
      m = dims !== "Z";
      at++;
    }
    if (CURVES.has(name)) throw Object.assign(new Error(name), { curve: name });
    const g = geometry(name, 0, z, m);
    if (isEmpty()) return g;
    body(g, name);
    return g;
  };

  /** A position: x and y kept, a third ordinate Z unless the type said M. */
  const position = (/** @type {Geometry} */ g, /** @type {number[]} */ into) => {
    const values = [];
    for (let n = peek()?.number; n !== undefined; n = peek()?.number) {
      values.push(n);
      at++;
    }
    if (values.length < 2) throw new Error("Not a geometry: a position needs x and y.");
    if (values.length === 4) g.z = g.m = true;
    else if (values.length === 3 && !g.m) g.z = true;
    into.push(/** @type {number} */ (values[0]), /** @type {number} */ (values[1]));
    g.vertices++;
  };
  /** `(x y, x y, ...)` as one run. */
  const run = (/** @type {Geometry} */ g) => {
    /** @type {number[]} */
    const xy = [];
    mark("(");
    do position(g, xy);
    while (comma());
    mark(")");
    return Float64Array.from(xy);
  };
  const rings = (/** @type {Geometry} */ g) => {
    /** @type {Float64Array[]} */
    const out = [];
    mark("(");
    do out.push(run(g));
    while (comma());
    mark(")");
    return out;
  };
  /** A list of members, each EMPTY or as `member` reads it. */
  const members = (/** @type {() => void} */ member) => {
    mark("(");
    do if (!isEmpty()) member();
    while (comma());
    mark(")");
  };

  const body = (/** @type {Geometry} */ g, /** @type {string} */ name) => {
    if (name === "Point") {
      mark("(");
      position(g, g.points);
      mark(")");
    } else if (name === "LineString") g.lines.push(run(g));
    else if (name === "Polygon" || name === "Triangle") g.polygons.push(rings(g));
    else if (name === "MultiPoint")
      members(() => {
        const bracketed = isMark("(");
        if (bracketed) at++;
        position(g, g.points);
        if (bracketed) mark(")");
      });
    else if (name === "MultiLineString") members(() => g.lines.push(run(g)));
    else if (name === "GeometryCollection") members(() => absorb(g, tagged()));
    else members(() => g.polygons.push(rings(g)));
  };

  try {
    const g = tagged();
    if (at !== tokens.length) throw new Error("Not a geometry: text is left after it.");
    g.srid = srid;
    return g;
  } catch (error) {
    const curve = /** @type {{ curve?: string }} */ (error).curve;
    if (curve) return { unread: curve, srid };
    throw error;
  }
}
