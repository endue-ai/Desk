// The readers of spatial values (PG-46, ui/geo/): EWKB hex, ISO WKB, WKT and EWKT, GeoJSON and
// PostgreSQL's own geometric types, held to what a real server wrote and said of each value
// (geo-corpus.ts: ST_NPoints, ST_SRID, GeometryType and its box).
import { describe, expect, it } from "vitest";
import { readGeoJson } from "../ui/geo/geojson.js";
import { boundsOf, type Geometry, isUnread } from "../ui/geo/geometry.js";
import { readGeometric } from "../ui/geo/pg-geometric.js";
import { looksWkb, readWkb } from "../ui/geo/wkb.js";
import { looksWkt, readWkt } from "../ui/geo/wkt.js";
import { CAPTURED, type Captured } from "./geo-corpus";

const CURVES = new Set(["CIRCULARSTRING", "CURVEPOLYGON"]);
const drawn = CAPTURED.filter((c) => !CURVES.has(c.type));
const read = (value: ReturnType<typeof readWkb>) => {
  expect(isUnread(value)).toBe(false);
  return value as Geometry;
};
/** What the server said of a value, as the readers say it. */
const said = (c: Captured) => ({
  type: c.type.replace(/M$/u, ""),
  m: c.type.endsWith("M") || c.ewkt.includes("(1 2 3 4)"),
  vertices: c.vertices,
  bounds: c.bounds,
});
const facts = (g: Geometry) => ({
  type: g.type.toUpperCase(),
  m: g.m,
  vertices: g.vertices,
  bounds: boundsOf(g),
});

describe("geometry readers", () => {
  it("reads EWKB hex of every simple type with its SRID, Z and M", () => {
    for (const c of drawn) {
      const g = read(readWkb(c.hex));
      expect([c.name, facts(g)]).toEqual([c.name, said(c)]);
      expect([c.name, g.srid]).toEqual([c.name, c.srid]);
    }
    const z = read(readWkb(CAPTURED.find((c) => c.name === "point z")?.hex ?? ""));
    expect([z.z, z.m, z.points]).toEqual([true, false, [1, 2]]);
    const hole = read(readWkb(CAPTURED.find((c) => c.name === "polygon with a hole")?.hex ?? ""));
    expect(hole.polygons).toHaveLength(1);
    expect(hole.polygons[0]?.map((ring) => ring.length / 2)).toEqual([5, 5]);
    const collection = read(readWkb(CAPTURED.find((c) => c.name === "collection")?.hex ?? ""));
    expect([collection.points, collection.lines.length, collection.polygons.length]).toEqual([
      [1, 1],
      1,
      1,
    ]);
    // ISO WKB (ST_AsBinary): Z, M and ZM as 1000, 2000 and 3000 over the type, no SRID.
    for (const c of drawn.filter((c) => c.iso)) {
      const g = read(readWkb(c.iso));
      expect([c.name, facts(g), g.srid]).toEqual([c.name, said(c), 0]);
    }
    // Big-endian: POINT(1 2).
    expect(read(readWkb("00000000013FF00000000000004000000000000000")).points).toEqual([1, 2]);
  });

  it("reads WKT, EWKT, GeoJSON and the built-in geometric types to the same shapes", () => {
    for (const c of drawn) {
      const g = read(readWkt(c.ewkt));
      expect([c.name, facts(g), g.srid]).toEqual([c.name, said(c), c.srid]);
      expect(looksWkt(c.ewkt)).toBe(true);
    }
    expect(read(readWkt("POINT Z (1 2 3)"))).toMatchObject({ z: true, m: false, points: [1, 2] });
    expect(read(readWkt("MULTIPOINT(1 2, 3 4)")).points).toEqual([1, 2, 3, 4]);
    expect(read(readWkt("MULTIPOINT((1 2), EMPTY, (3 4))")).vertices).toBe(2);
    for (const c of drawn.filter((c) => c.geojson)) {
      const g = readGeoJson(c.geojson);
      // GeoJSON has no M; a value without a crs is WGS 84 (RFC 7946).
      expect([c.name, { ...facts(g), m: false }, g.srid]).toEqual([
        c.name,
        { ...said(c), m: false },
        c.srid || 4326,
      ]);
    }
    const feature = readGeoJson({
      type: "Feature",
      geometry: { type: "Point", coordinates: [3, 4] },
    });
    expect([feature.type, feature.points]).toEqual(["Point", [3, 4]]);
    // As PostgreSQL 17 printed them (point, lseg, box, path open and closed, polygon, circle).
    const point = readGeometric("(1.5,-2)", "point");
    expect([point.points, point.vertices, point.srid]).toEqual([[1.5, -2], 1, 0]);
    const lseg = readGeometric("[(0,0),(3,4)]", "lseg");
    expect([[...(lseg.lines[0] ?? [])], lseg.vertices]).toEqual([[0, 0, 3, 4], 2]);
    const box = readGeometric("(3,4),(0,0)", "box");
    expect([boundsOf(box), box.vertices, box.polygons[0]?.[0]?.length]).toEqual([
      [0, 0, 3, 4],
      2,
      10,
    ]);
    const open = readGeometric("[(0,0),(1,1),(2,0)]", "path");
    expect([open.type, open.lines[0]?.length, open.vertices]).toEqual(["path (open)", 6, 3]);
    const shut = readGeometric("((0,0),(1,1),(2,0))", "path");
    expect([shut.type, shut.lines[0]?.length, shut.vertices]).toEqual(["path (closed)", 8, 3]);
    const polygon = readGeometric("((0,0),(4,0),(4,3))", "polygon");
    expect([polygon.polygons[0]?.[0]?.length, polygon.vertices]).toEqual([8, 3]);
    const circle = readGeometric("<(1,2),3>", "circle");
    expect([circle.radius, circle.vertices, boundsOf(circle)?.map((v) => Math.round(v))]).toEqual([
      3,
      1,
      [-2, -1, 4, 5],
    ]);
  });

  it("names a curve as one to read from the server and refuses what is not a geometry", () => {
    const arc = CAPTURED.find((c) => c.name === "circular string") as Captured;
    expect(readWkb(arc.hex)).toEqual({ unread: "CircularString", srid: 4326 });
    expect(readWkt(arc.ewkt)).toEqual({ unread: "CircularString", srid: 4326 });
    const curved = CAPTURED.find((c) => c.name === "curve polygon") as Captured;
    expect(readWkb(curved.hex)).toEqual({ unread: "CurvePolygon", srid: 0 });
    const line = CAPTURED.find((c) => c.name === "line") as Captured;
    expect(() => readWkb(line.hex.slice(0, -2))).toThrow(/end too soon/u);
    expect(() => readWkb(`${line.hex}00`)).toThrow(/left after/u);
    expect(() => readWkb(`${line.hex.slice(0, -1)}G`)).toThrow(/not a digit/u);
    expect(() => readWkb("0163000000")).toThrow(/is not one/u);
    expect(() => readWkt("POINT(1)")).toThrow(/x and y/u);
    expect(() => readWkt("POINT(1 2) x")).toThrow();
    expect(() => readGeoJson('{"type":"Circle"}')).toThrow(/not a GeoJSON type/u);
    expect(() => readGeometric("(1)", "point")).toThrow();
    for (const c of CAPTURED) expect([c.name, looksWkb(c.hex)]).toEqual([c.name, true]);
    expect(looksWkb("\\x0101000000")).toBe(false);
    expect(looksWkb("0123456789abcdef0123")).toBe(false);
    expect(looksWkb("deadbeefdeadbeefdeadbeef")).toBe(false);
    expect(looksWkt("Point of view (it is text)")).toBe(false);
  });
});
