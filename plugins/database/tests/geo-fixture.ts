// The map's fixtures (PG-46): a scripted PostgreSQL server, on any connection, that answers a
// table of parcels (five shapes and a NULL, among them a curve, all SRID 4326) and one of twenty
// thousand squares, as a server with the spatial extension prints a geometry column (EWKB hex, the
// type's OID as one such server gave it), and the viewer's own statement that reads the curve back
// as a GeoJSON line. Fixture data only; nothing here needs Node.
import type { Script } from "./clients";

/** The OID a server gave the geometry type; an extension's types have no fixed OID. */
export const GEOMETRY_OID = 16394;
export const PARCELS = "select id, name, geom from parcels";
export const MANY = "select id, geom from parcels_many";
export const MANY_ROWS = 20_000;

/** A little-endian EWKB value with an SRID: its type, then what `body` writes. */
function ewkb(type: number, srid: number, body: number[][]): string {
  const doubles = body.flat();
  const counts = body.length;
  const bytes = new DataView(new ArrayBuffer(9 + 4 + 8 * doubles.length + 4 * counts));
  bytes.setUint8(0, 1);
  bytes.setUint32(1, (type | 0x20000000) >>> 0, true);
  bytes.setUint32(5, srid, true);
  let at = 9;
  const parts = body.length;
  if (type === 3) {
    bytes.setUint32(at, parts, true);
    at += 4;
  }
  for (const part of body) {
    if (type !== 1) {
      bytes.setUint32(at, part.length / 2, true);
      at += 4;
    }
    for (const value of part) {
      bytes.setFloat64(at, value, true);
      at += 8;
    }
  }
  return [...new Uint8Array(bytes.buffer, 0, at)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}
const square = (x: number, y: number, w: number) => [
  [x, y, x + w, y, x + w, y + w, x, y + w, x, y],
];

/** The curve's control points and the line the server's ST_CurveToLine makes of it, as GeoJSON. */
const ARC = [127.015, 37.56, 127.0225, 37.5675, 127.03, 37.56];
export const ARC_HEX = ewkb(8, 4326, [ARC]);
export const ARC_AS_LINE = JSON.stringify({
  type: "LineString",
  coordinates: Array.from({ length: 33 }, (_, i) => {
    const a = Math.PI - (i / 32) * Math.PI;
    return [127.0225 + 0.0075 * Math.cos(a), 37.56 + 0.0075 * Math.sin(a)].map(
      (v) => Math.round(v * 1e9) / 1e9,
    );
  }),
});

/** The parcels: a square that holds the middle of them all, a river, a block with a yard, a well, an arc. */
export const PARCEL_ROWS: (string | null)[][] = [
  ["1", "harbour", ewkb(3, 4326, square(126.99, 37.54, 0.02))],
  ["2", "river", ewkb(2, 4326, [[126.97, 37.53, 126.985, 37.536, 127.0, 37.532, 127.03, 37.53]])],
  [
    "3",
    "north block",
    ewkb(3, 4326, [
      [126.97, 37.556, 126.986, 37.556, 126.986, 37.57, 126.97, 37.57, 126.97, 37.556],
      [126.974, 37.56, 126.974, 37.566, 126.982, 37.566, 126.982, 37.56, 126.974, 37.56],
    ]),
  ],
  ["4", "well", ewkb(1, 4326, [[127.02, 37.545]])],
  ["5", "arc", ARC_HEX],
  ["6", "nothing", null],
];

let many: (string | null)[][] | undefined;
/** Twenty thousand squares in a grid of 200 by 100 cells, 0.001° apart. */
function manyRows() {
  many ??= Array.from({ length: MANY_ROWS }, (_, i) => [
    String(i + 1),
    ewkb(3, 4326, square(126.9 + (i % 200) * 0.001, 37.5 + Math.floor(i / 200) * 0.001, 0.0008)),
  ]);
  return many;
}

/** The map's statements answered, anything else by `base`. */
export function geoServer(base: Script = () => ({})): Script {
  return (sql, who) => {
    const text = sql.trim();
    if (text === PARCELS)
      return { rows: [["id", "name", "geom"], ...PARCEL_ROWS], types: [23, 25, GEOMETRY_OID] };
    if (text === MANY) return { rows: [["id", "geom"], ...manyRows()], types: [23, GEOMETRY_OID] };
    if (text.startsWith("SELECT ST_AsGeoJSON(ST_CurveToLine(t.v::geometry))")) {
      const values = [...text.matchAll(/'([0-9A-F]+)'/gu)].map((m) => m[1]);
      return {
        rows: [["st_asgeojson"], ...values.map((v) => [v === ARC_HEX ? ARC_AS_LINE : null])],
      };
    }
    return base(sql, who);
  };
}
