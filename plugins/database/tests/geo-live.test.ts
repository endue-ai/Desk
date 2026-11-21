// The map's readers (PG-46, #473) against a real PostgreSQL, when ENDUE_DB_TEST_POSTGRES holds a
// scratch database's URI: the built-in geometric types as the server prints them, found by their
// OIDs and drawn; and, when the server has the geometry and geography types, a table of every
// kind of shape and thousands of generated ones read from the server's EWKB hex to the vertex
// counts, SRIDs and boxes the server gives for each (ST_NPoints, ST_SRID, ST_XMin...), with a
// curve read back through the viewer's own statement. A server without those types skips them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { readSql } from "../ui/features/geo/index.js";
import { spatialColumns } from "../ui/geo/detect.js";
import { createEngine } from "../ui/geo/engine.js";
import { boundsOf, type Geometry, isUnread } from "../ui/geo/geometry.js";
import type { Summary } from "../ui/geo/layer.js";
import { buildLayer } from "../ui/geo/layer.js";
import { readWkb } from "../ui/geo/wkb.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";

/** The executor on the core's sessions, as live.test.ts makes it. */
function liveHarness(given: string) {
  const { fields, password } = parseUri(given);
  const conn = normalize({ ...fields, id: "c-live", name: "live", readOnly: false });
  const bridge = nodeBridge();
  const runner = createRunner(bridge);
  const settings = fromValues({ "endue.database.max-rows": 10_000 });
  const executor = createExecutor({
    runner,
    output: inProcessOutput(),
    clients: createClients(runner, () => settings),
    sessions: createSessions(bridge),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  return { conn, execute: executor.execute };
}

const uri = process.env.ENDUE_DB_TEST_POSTGRES;

describe.skipIf(!uri)("the map's readers on a real server", () => {
  let made: ReturnType<typeof liveHarness> | undefined;
  const harness = () => {
    made ??= liveHarness(uri ?? "");
    return made;
  };
  /** The first set of the last statement of `sql`, as the grid gets it. */
  const select = async (sql: string, options = {}) => {
    const { conn, execute } = harness();
    const run = await execute(conn, sql, options);
    const statement = run.result.statements.at(-1);
    expect(statement?.error).toBeUndefined();
    const set = statement?.sets[0];
    if (!set) throw new Error(`No rows from: ${sql}`);
    return set;
  };
  const near = (a: number[] | null | undefined, b: number[]) => {
    expect(a).toHaveLength(4);
    b.forEach((v, i) => {
      expect(a?.[i]).toBeCloseTo(v, 6);
    });
  };
  let spatial = false;

  beforeAll(async () => {
    const has = await select(
      "select to_regtype('geometry') is not null, to_regtype('geography') is not null",
    );
    spatial = has.rows[0]?.every((v) => v === "t" || v === "true") ?? false;
    await select(
      "drop table if exists t473_builtin;\n" +
        "create table t473_builtin (id int, p point, s lseg, b box, o path, c path, g polygon, r circle, l line);\n" +
        "insert into t473_builtin values " +
        "(1, '(1.5,-2)', '[(0,0),(3,4)]', '(3,4),(0,0)', '[(0,0),(1,1),(2,0)]', '((0,0),(1,1),(2,0))', " +
        "'((0,0),(4,0),(4,3))', '<(1,2),3>', '{1,-1,0}'), " +
        "(2, '(10,10)', '[(5,5),(6,9)]', '(1,1),(-1,-1)', '[(0,0),(9,9)]', '((1,0),(0,1),(-1,0),(0,-1))', " +
        "'((0,0),(1,0),(1,1),(0,1))', '<(0,0),0.5>', '{0,1,-2}');\n" +
        "select 1",
    );
  });
  afterAll(async () => {
    if (!made) return;
    await select(
      "drop table if exists t473_builtin;\ndrop table if exists t473_shapes;\ndrop table if exists t473_many;\nselect 1",
    );
  });

  it("finds the built-in geometric types by their OIDs and reads each as the server prints it", async () => {
    const set = await select(
      "select *, npoints(o) as no, npoints(c) as nc, npoints(g) as ng, radius(r) as rr " +
        "from t473_builtin order by id",
    );
    expect(set.types?.slice(1, 9)).toEqual([600, 601, 603, 602, 602, 604, 718, 628]);
    expect(spatialColumns(set).map((c) => [c.name, c.kind])).toEqual([
      ["p", "point"],
      ["s", "lseg"],
      ["b", "box"],
      ["o", "path"],
      ["c", "path"],
      ["g", "polygon"],
      ["r", "circle"],
    ]);
    const column = (name: string) => set.columns.indexOf(name);
    const layerOf = (name: string, kind: Parameters<typeof buildLayer>[1]) =>
      buildLayer(
        set.rows.map((r) => r[column(name)] ?? null),
        kind,
      );
    for (const [name, kind] of [
      ["p", "point"],
      ["s", "lseg"],
      ["b", "box"],
      ["o", "path"],
      ["c", "path"],
      ["g", "polygon"],
      ["r", "circle"],
    ] as const) {
      const layer = layerOf(name, kind);
      expect([name, layer.shapes.length, layer.failed]).toEqual([name, 2, []]);
    }
    set.rows.forEach((row, i) => {
      const counts = (name: string, kind: Parameters<typeof buildLayer>[1]) =>
        layerOf(name, kind).shapes[i]?.g.vertices;
      expect(counts("o", "path")).toBe(Number(row[column("no")]));
      expect(counts("c", "path")).toBe(Number(row[column("nc")]));
      expect(counts("g", "polygon")).toBe(Number(row[column("ng")]));
      expect(layerOf("r", "circle").shapes[i]?.g.radius).toBe(Number(row[column("rr")]));
    });
    const polygon = layerOf("g", "polygon").shapes[0]?.g as Geometry;
    expect(boundsOf(polygon)?.slice(2)).toEqual([4, 3]);
  });

  it("reads geometry and geography values to the server's own vertex counts, SRIDs and boxes", async (ctx) => {
    if (!spatial) return ctx.skip();
    await select(
      "drop table if exists t473_shapes;\n" +
        "create table t473_shapes (id int, g geometry, gg geography);\n" +
        "insert into t473_shapes (id, g) values " +
        "(1, 'SRID=4326;POINT(126.978 37.5665)'), (2, 'POINT EMPTY'), (3, 'SRID=3857;POINT Z (1 2 3)'), " +
        "(4, 'POINT M (1 2 3)'), (5, 'POINT ZM (1 2 3 4)'), (6, 'SRID=4326;LINESTRING(0 0, 1 1, 2 0)'), " +
        "(7, 'POLYGON((0 0, 10 0, 10 10, 0 10, 0 0), (2 2, 4 2, 4 4, 2 4, 2 2))'), " +
        "(8, 'MULTIPOINT((1 2), (3 4))'), (9, 'SRID=32652;MULTILINESTRING((0 0, 1 1), (2 2, 3 3, 4 4))'), " +
        "(10, 'MULTIPOLYGON(((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))'), " +
        "(11, 'GEOMETRYCOLLECTION(POINT(1 1), LINESTRING(0 0, 2 2), POLYGON((0 0, 1 0, 0 1, 0 0)))'), " +
        "(12, 'TRIANGLE((0 0, 1 0, 0 1, 0 0))'), (13, 'TIN(((0 0 0, 1 0 0, 0 1 0, 0 0 0)))'), " +
        "(14, 'POLYHEDRALSURFACE(((0 0 0, 0 1 0, 1 1 0, 1 0 0, 0 0 0)))'), " +
        "(15, ST_SetSRID(ST_Buffer(ST_MakePoint(127, 37.5), 0.01, 32), 4326));\n" +
        "update t473_shapes set gg = g::geography where ST_SRID(g) = 4326;\n" +
        "select 1",
    );
    const set = await select(
      "select id, g, gg, ST_NPoints(g), ST_SRID(g), ST_IsEmpty(g), " +
        "ST_XMin(g), ST_YMin(g), ST_XMax(g), ST_YMax(g), ST_SRID(gg::geometry) from t473_shapes order by id",
    );
    expect(spatialColumns(set).map((c) => [c.name, c.kind])).toEqual([
      ["g", "wkb"],
      ["gg", "wkb"],
    ]);
    for (const row of set.rows) {
      const [id, hex, geo, points, srid, empty, ...rest] = row;
      const g = readWkb(hex ?? "") as Geometry;
      expect([id, isUnread(g), g.vertices, g.srid]).toEqual([
        id,
        false,
        Number(points),
        Number(srid),
      ]);
      if (empty === "t") expect(boundsOf(g)).toBeNull();
      else near(boundsOf(g), rest.slice(0, 4).map(Number));
      if (geo) {
        const gg = readWkb(geo) as Geometry;
        expect([id, gg.vertices, gg.srid]).toEqual([id, Number(points), Number(rest[4])]);
      }
    }
  });

  it("reads twenty thousand shapes from the server's hex in the worker's engine, a summary each", async (ctx) => {
    if (!spatial) return ctx.skip();
    await select(
      "drop table if exists t473_many;\n" +
        "create table t473_many as select n as id, ST_SetSRID(ST_Buffer(ST_MakePoint(126.8 + (n % 200) * 0.002, " +
        "37.4 + (n / 200) * 0.002), 0.0008, 2), 4326) as g from generate_series(0, 19999) as n;\n" +
        "select 1",
    );
    const set = await select("select id, g from t473_many order by id", { maxRows: 20_000 });
    const totals = await select(
      "select sum(ST_NPoints(g)), min(ST_XMin(g)), max(ST_YMax(g)) from t473_many",
    );
    expect(set.rows).toHaveLength(20_000);
    const engine = createEngine();
    const started = performance.now();
    const { reply } = engine.answer({
      id: 1,
      op: "load",
      key: "many",
      kind: "wkb",
      values: set.rows.map((r) => r[1] ?? null),
    });
    const ms = performance.now() - started;
    const [sum, xmin, ymax] = totals.rows[0] ?? [];
    const summary = reply.summary as Summary;
    expect(summary).toMatchObject({ rows: 20_000, shapes: 20_000, srid: 4326, failed: 0 });
    expect(summary.vertices).toBe(Number(sum));
    expect(summary.bounds?.[0]).toBeCloseTo(Number(xmin), 9);
    expect(summary.bounds?.[3]).toBeCloseTo(Number(ymax), 9);
    // Read off the frame, but not slowly: well under two seconds on a laptop.
    expect(ms).toBeLessThan(2000);
  });

  it("reads a curve back through the viewer's own statement, never the person's", async (ctx) => {
    if (!spatial) return ctx.skip();
    const set = await select(
      "select g, ST_NPoints(ST_CurveToLine(g)) from (values " +
        "('SRID=4326;CIRCULARSTRING(0 0, 1 1, 2 0)'::geometry), " +
        "('SRID=4326;CURVEPOLYGON(CIRCULARSTRING(0 0, 4 0, 4 4, 0 4, 0 0))'::geometry)) as t(g)",
    );
    const values = set.rows.map((r) => r[0] ?? "");
    const layer = buildLayer(values, "wkb");
    expect(layer.unread.map((u) => u.type)).toEqual(["CircularString", "CurvePolygon"]);
    const back = await select(readSql(values), { catalog: true, maxRows: values.length });
    const engine = createEngine();
    engine.answer({ id: 1, op: "load", key: "arcs", kind: "wkb", values });
    const read = engine.answer({
      id: 2,
      op: "read",
      key: "arcs",
      rows: [0, 1],
      texts: back.rows.map((r) => r[0] ?? null),
    }).reply;
    expect(read.summary).toMatchObject({ shapes: 2, unread: [], failed: 0, srid: 4326 });
    expect((read.summary as Summary).vertices).toBe(set.rows.reduce((n, r) => n + Number(r[1]), 0));
  });
});
