// One value of a spatial column read by its kind (geo/detect.js): EWKB hex, WKT, GeoJSON or a
// built-in geometric type's text. Pure; the map's worker runs it (geo/engine.js).

import { readGeoJson } from "./geojson.js";
import { readGeometric } from "./pg-geometric.js";
import { readWkb } from "./wkb.js";
import { readWkt } from "./wkt.js";

/**
 * @typedef {import("./detect.js").Kind} Kind
 * @typedef {import("./geometry.js").Geometry} Geometry
 * @typedef {import("./geometry.js").Unread} Unread
 */

/**
 * @param {string} value
 * @param {Kind} kind
 * @returns {Geometry | Unread}
 */
export function readValue(value, kind) {
  if (kind === "wkb") return readWkb(value);
  if (kind === "wkt") return readWkt(value);
  if (kind === "geojson") return readGeoJson(value);
  return readGeometric(value, kind);
}
