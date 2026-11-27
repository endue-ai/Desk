// Well-known binary as hex (PG-46), the text the server prints for geometry and geography: EWKB
// (the Z, M and SRID flags in the type's high bits) and ISO WKB (Z, M and ZM as 1000, 2000 and
// 3000 over the type), either byte order, members of multi types and collections nested. POINT
// EMPTY is NaN, NaN. A curve comes back unread by its type; anything cut short, with bytes left
// over or of an unknown type is an error. Pure; the map's worker runs it (geo/engine.js).

import { t } from "../strings/index.js";
import { absorb, geometry } from "./geometry.js";

/** @typedef {import("./geometry.js").Geometry} Geometry @typedef {import("./geometry.js").Unread} Unread */

export const TYPES = /** @type {Record<number, string>} */ ({
  1: "Point",
  2: "LineString",
  3: "Polygon",
  4: "MultiPoint",
  5: "MultiLineString",
  6: "MultiPolygon",
  7: "GeometryCollection",
  8: "CircularString",
  9: "CompoundCurve",
  10: "CurvePolygon",
  11: "MultiCurve",
  12: "MultiSurface",
  15: "PolyhedralSurface",
  16: "Tin",
  17: "Triangle",
});
const CURVES = new Set([8, 9, 10, 11, 12]);

/** A hex digit's value by its character code; -1 for any other character. */
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < 16; i++) {
  DIGIT["0123456789abcdef".charCodeAt(i)] = i;
  DIGIT["0123456789ABCDEF".charCodeAt(i)] = i;
}

/** The bytes of a hex text; throws on a character that is not a digit or an odd length. */
export function bytesOf(/** @type {string} */ hex) {
  if (hex.length % 2 !== 0) throw new Error(t("geo.wkb.notAGeometryTheHexHas"));
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = DIGIT[hex.charCodeAt(i * 2)] ?? -1;
    const lo = DIGIT[hex.charCodeAt(i * 2 + 1)] ?? -1;
    if (hi < 0 || lo < 0) throw new Error(t("geo.wkb.notAGeometryTheHexHolds"));
    out[i] = hi * 16 + lo;
  }
  return out;
}

/** A thrown marker: the value holds a curve, read on the server instead. */
class Curve extends Error {
  constructor(/** @type {string} */ type) {
    super(type);
    this.type = type;
  }
}

/**
 * Read one value.
 * @param {string} hex
 * @returns {Geometry | Unread}
 */
export function readWkb(hex) {
  const bytes = bytesOf(hex);
  const data = new DataView(bytes.buffer);
  let at = 0;
  let srid = 0;
  const need = (/** @type {number} */ n) => {
    if (at + n > bytes.length) throw new Error(t("geo.wkb.notAGeometryTheBytesEnd"));
  };

  /** One geometry at `at`, its header first. @returns {Geometry} */
  const read = () => {
    need(5);
    const order = bytes[at];
    if (order !== 0 && order !== 1) throw new Error(t("geo.wkb.notAGeometryNoByteOrder"));
    const little = order === 1;
    const raw = data.getUint32(at + 1, little);
    at += 5;
    const base = raw & 0x0fffffff;
    const code = base % 1000;
    const iso = Math.floor(base / 1000);
    const type = TYPES[code];
    if (!type || iso > 3 || (raw & 0x10000000) !== 0)
      throw new Error(t("geo.wkb.notAGeometryTypeIsNot", { base: String(base) }));
    const z = (raw & 0x80000000) !== 0 || iso === 1 || iso === 3;
    const m = (raw & 0x40000000) !== 0 || iso === 2 || iso === 3;
    if (raw & 0x20000000) {
      need(4);
      srid = data.getInt32(at, little);
      at += 4;
    }
    if (CURVES.has(code)) throw new Curve(type);
    const dims = 2 + (z ? 1 : 0) + (m ? 1 : 0);
    const g = geometry(type, 0, z, m);
    const count = () => {
      need(4);
      const n = data.getUint32(at, little);
      at += 4;
      return n;
    };
    const run = (/** @type {number} */ n) => {
      need(n * dims * 8);
      const xy = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        xy[i * 2] = data.getFloat64(at, little);
        xy[i * 2 + 1] = data.getFloat64(at + 8, little);
        at += dims * 8;
      }
      g.vertices += n;
      return xy;
    };
    if (code === 1) {
      const [x = Number.NaN, y = Number.NaN] = run(1);
      if (Number.isNaN(x) && Number.isNaN(y)) g.vertices = 0;
      else g.points.push(x, y);
    } else if (code === 2) {
      const n = count();
      if (n > 0) g.lines.push(run(n));
    } else if (code === 3 || code === 17) {
      const rings = [];
      for (let r = count(); r > 0; r--) rings.push(run(count()));
      if (rings.length) g.polygons.push(rings);
    } else for (let n = count(); n > 0; n--) absorb(g, read());
    return g;
  };

  try {
    const g = read();
    if (at !== bytes.length) throw new Error(t("geo.wkb.notAGeometryBytesAreLeft"));
    g.srid = srid;
    return g;
  } catch (error) {
    if (error instanceof Curve) return { unread: error.type, srid };
    throw error;
  }
}

/** Whether a text starts as EWKB hex of a known type does: for a column's first values. */
export function looksWkb(/** @type {string} */ text) {
  if (text.length < 18 || text.length % 2 !== 0) return false;
  if (!/^0[01][0-9a-fA-F]{8}/u.test(text) || (DIGIT[text.charCodeAt(text.length - 1)] ?? -1) < 0)
    return false;
  const word = text.slice(2, 10);
  const le = text[1] === "1";
  const hex = le ? (word.match(/../gu) ?? []).reverse().join("") : word;
  const raw = Number.parseInt(hex, 16);
  const base = raw & 0x0fffffff;
  return TYPES[base % 1000] !== undefined && base < 4000 && (raw & 0x10000000) === 0;
}
