// Which columns of a result hold shapes (PG-46): a built-in geometric type by its OID, any other
// column by its values, since an extension's types have no fixed OID: its first values that are
// not NULL (16 at most) all start as EWKB hex, as WKT or EWKT, or as a GeoJSON geometry. Only the
// start of each value is looked at, so this stays cheap on the frame's thread; the worker reads
// them whole (geo/engine.js). Pure.

import { looksGeoJson } from "./geojson.js";
import { GEOMETRIC } from "./pg-geometric.js";
import { looksWkb } from "./wkb.js";
import { looksWkt } from "./wkt.js";

/**
 * @typedef {"wkb" | "wkt" | "geojson" | "point" | "lseg" | "path" | "box" | "polygon" | "circle"} Kind
 * @typedef {{ column: number, name: string, kind: Kind }} Spatial
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 */

const SAMPLE = 16;
/** A JSON value's start is enough to tell; a long value is cut here before its tests. */
const HEAD = 512;

/** The kind of one value by how it starts; undefined when it is no shape. */
export function kindOfValue(/** @type {string | null | undefined} */ value) {
  if (typeof value !== "string" || value === "") return undefined;
  if (looksWkb(value)) return /** @type {Kind} */ ("wkb");
  const head = value.length > HEAD ? value.slice(0, HEAD) : value;
  if (looksWkt(head)) return /** @type {Kind} */ ("wkt");
  if (looksGeoJson(head)) return /** @type {Kind} */ ("geojson");
  return undefined;
}

/** The kind of a value of a column whose type OID may be a built-in geometric type. */
export function kindOf(/** @type {string | null} */ value, /** @type {number | undefined} */ oid) {
  const builtin = oid === undefined ? undefined : GEOMETRIC[oid];
  return builtin ? /** @type {Kind} */ (builtin) : kindOfValue(value);
}

/**
 * The columns of a result set that hold shapes, in their order.
 * @param {ResultSet} set
 * @returns {Spatial[]}
 */
export function spatialColumns(set) {
  /** @type {Spatial[]} */
  const found = [];
  set.columns.forEach((name, column) => {
    const builtin = GEOMETRIC[set.types?.[column] ?? -1];
    if (builtin) {
      found.push({ column, name, kind: /** @type {Kind} */ (builtin) });
      return;
    }
    /** @type {Kind | undefined} */
    let kind;
    let seen = 0;
    for (const row of set.rows) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      const here = kindOfValue(value);
      if (!here || (kind && here !== kind)) return;
      kind = here;
      if (++seen >= SAMPLE) break;
    }
    if (kind) found.push({ column, name, kind });
  });
  return found;
}
