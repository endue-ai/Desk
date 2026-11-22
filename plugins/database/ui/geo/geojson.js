// GeoJSON (PG-46): a geometry object as ST_AsGeoJSON writes it (its `crs` naming the SRID, 4326
// when none is named, as RFC 7946 has it), a Feature's geometry, and collections nested. A third
// ordinate is Z. Pure; the map's worker runs it (geo/engine.js).

import { absorb, geometry } from "./geometry.js";

/** @typedef {import("./geometry.js").Geometry} Geometry */

const TYPES = new Set([
  "Point",
  "LineString",
  "Polygon",
  "MultiPoint",
  "MultiLineString",
  "MultiPolygon",
  "GeometryCollection",
]);
const START =
  /^\s*\{\s*"type"\s*:\s*"(?:Point|LineString|Polygon|MultiPoint|MultiLineString|MultiPolygon|GeometryCollection|Feature)"/u;

/** Whether a text starts as a GeoJSON geometry does: for a column's first values. */
export const looksGeoJson = (/** @type {string} */ text) => START.test(text);

/** The SRID a `crs` member names (`EPSG:3857`, `urn:ogc:def:crs:EPSG::3857`), else 4326. */
function sridOf(/** @type {any} */ crs) {
  const name = String(crs?.properties?.name ?? "");
  const found = /EPSG:{1,2}(\d+)$/u.exec(name);
  return found ? Number(found[1]) : 4326;
}

/**
 * Read one value, as text or as the object it parses to.
 * @param {string | object} value
 * @returns {Geometry}
 */
export function readGeoJson(value) {
  /** @type {any} */
  let object;
  try {
    object = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("Not a geometry: the text is not JSON.");
  }
  if (object?.type === "Feature") {
    const inner = object.geometry
      ? readGeoJson({ crs: object.crs, ...object.geometry })
      : geometry("GeometryCollection");
    return inner;
  }
  const g = read(object);
  g.srid = sridOf(object?.crs);
  return g;
}

/** @returns {Geometry} */
function read(/** @type {any} */ object) {
  const type = object?.type;
  if (!TYPES.has(type)) throw new Error(`Not a geometry: ${String(type)} is not a GeoJSON type.`);
  const g = geometry(type);
  /** A position into a flat run. */
  const position = (/** @type {unknown} */ p, /** @type {number[]} */ into) => {
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== "number" || typeof p[1] !== "number")
      throw new Error("Not a geometry: a position needs x and y.");
    if (p.length > 2) g.z = true;
    into.push(p[0], p[1]);
    g.vertices++;
  };
  const run = (/** @type {unknown} */ list) => {
    /** @type {number[]} */
    const xy = [];
    for (const p of array(list)) position(p, xy);
    return Float64Array.from(xy);
  };
  const rings = (/** @type {unknown} */ list) => array(list).map(run);
  const c = object.coordinates;
  if (type === "Point") {
    if (array(c).length) position(c, g.points);
  } else if (type === "LineString") {
    if (array(c).length) g.lines.push(run(c));
  } else if (type === "Polygon") {
    if (array(c).length) g.polygons.push(rings(c));
  } else if (type === "MultiPoint") for (const p of array(c)) position(p, g.points);
  else if (type === "MultiLineString") for (const l of array(c)) g.lines.push(run(l));
  else if (type === "MultiPolygon") for (const p of array(c)) g.polygons.push(rings(p));
  else
    for (const member of array(object.geometries)) {
      const part = read(member);
      g.z ||= part.z;
      absorb(g, part);
    }
  return g;
}

/** A list, or an error that says the value is not one. */
function array(/** @type {unknown} */ value) {
  if (!Array.isArray(value)) throw new Error("Not a geometry: coordinates are not a list.");
  return value;
}
