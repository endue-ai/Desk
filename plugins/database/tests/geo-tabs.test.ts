// Which results get a Map tab (PG-46, ui/geo/detect.js through ui/tabs.js): a column of a built-in
// geometric type by its OID, any other by its values (EWKB hex as the server prints geometry and
// geography, WKT or EWKT, GeoJSON), never bytea, plain text or a column that mixes them.
import { describe, expect, it } from "vitest";
import type { ResultSet } from "../ui/engines/common.js";
import type { Execution } from "../ui/execute.js";
import { spatialColumns } from "../ui/geo/detect.js";
import { buildLayer, readBack, summaryOf } from "../ui/geo/layer.js";
import { classify } from "../ui/sql/classify.js";
import { split } from "../ui/sql/split.js";
import { show } from "../ui/tabs.js";
import { CAPTURED } from "./geo-corpus";
import { ARC_AS_LINE, ARC_HEX, geoServer, MANY, MANY_ROWS, PARCELS } from "./geo-fixture";

const hex = (name: string) => CAPTURED.find((c) => c.name === name)?.hex ?? "";
const GEOMETRY_OID = 16394;

/** A run of `sql` whose statements each gave back the sets given. */
function ran(sql: string, sets: ResultSet[][]): Execution {
  const statements = split(sql, "postgresql");
  return {
    sql,
    at: 1,
    statements,
    classes: statements.map((s) => classify(s, "postgresql")),
    mode: "run",
    result: {
      ms: 3,
      notices: [],
      statements: sets.map((s, index) => ({
        index,
        ran: true,
        sets: s,
        affected: null,
        warnings: 0,
        notices: [],
      })),
    },
  } as unknown as Execution;
}

describe("a Map tab", () => {
  it("a result with a spatial column gets a Map tab after its rows tab", () => {
    const parcels: ResultSet = {
      columns: ["id", "name", "geom"],
      rows: [
        ["1", "north", hex("polygon with a hole")],
        ["2", "path", hex("line")],
        ["3", "nothing", null],
        ["4", "well", hex("point")],
      ],
      truncated: false,
      types: [23, 25, GEOMETRY_OID],
    };
    const one = show(ran("select * from parcels", [[parcels]]));
    expect(one.tabs.map((t) => [t.label, t.kind])).toEqual([
      ["Result", "rows"],
      ["Map", "map"],
      ["Messages", "messages"],
    ]);
    expect(one.open).toBe(0);
    expect(one.tabs[1]?.geo).toEqual({
      set: parcels,
      columns: [{ column: 2, name: "geom", kind: "wkb" }],
    });
    // A map tab holds no rows of its own: the grid's bar and its edits never take it for a result.
    expect(one.tabs[1]?.set).toBeUndefined();

    const builtin: ResultSet = {
      columns: ["p", "b", "c", "l"],
      rows: [["(1,2)", "(3,4),(0,0)", "<(1,2),3>", "{1,-1,0}"]],
      truncated: false,
      types: [600, 603, 718, 628],
    };
    const text: ResultSet = {
      columns: ["wkt", "json", "note"],
      rows: [
        [
          "SRID=4326;POINT(1 2)",
          '{"type":"LineString","coordinates":[[0,0],[1,1]]}',
          "POINT of sale",
        ],
        ["POLYGON((0 0,1 0,0 1,0 0))", '{"type":"Point","coordinates":[1,2]}', "x"],
      ],
      truncated: false,
      types: [25, 3802, 25],
    };
    const two = show(ran("select 1; select 2", [[builtin], [text]]));
    expect(two.tabs.map((t) => t.label)).toEqual(["1", "Map 1", "2", "Map 2", "Messages"]);
    expect(two.tabs[1]?.geo?.columns.map((c) => [c.name, c.kind])).toEqual([
      ["p", "point"],
      ["b", "box"],
      ["c", "circle"],
    ]);
    expect(two.tabs[3]?.geo?.columns.map((c) => [c.name, c.kind])).toEqual([
      ["wkt", "wkt"],
      ["json", "geojson"],
    ]);
  });

  it("gives none to bytea, plain text, a mix of kinds, or a column of NULLs", () => {
    const set: ResultSet = {
      columns: ["bytes", "words", "mixed", "nulls", "hashes"],
      rows: [
        ["\\x0101000000", "hello", hex("point"), null, "0123456789abcdef0123456789abcdef"],
        ["\\x00", "POINT(1 2) is a place", "POINT(1 2)", null, "deadbeef00112233"],
      ],
      truncated: false,
      types: [17, 25, 25, 25, 25],
    };
    expect(spatialColumns(set)).toEqual([]);
    const shown = show(ran("select 1", [[set]]));
    expect(shown.tabs.map((t) => t.kind)).toEqual(["rows", "messages"]);
  });

  it("reads the runtime e2e's fixture whole: the parcels with their curve, and the squares", () => {
    const server = geoServer();
    const parcels = server(PARCELS, {});
    const many = server(MANY, {});
    if (parcels === "auth" || many === "auth") throw new Error("no sign-in here");
    const set = (a: typeof parcels): ResultSet => ({
      columns: (a.rows?.[0] ?? []) as string[],
      rows: a.rows?.slice(1) ?? [],
      truncated: false,
      types: a.types ?? [],
    });
    expect(spatialColumns(set(parcels))).toEqual([{ column: 2, name: "geom", kind: "wkb" }]);
    const layer = buildLayer(
      set(parcels).rows.map((r) => r[2] ?? null),
      "wkb",
    );
    expect(layer.unread).toEqual([{ row: 4, type: "CircularString", srid: 4326 }]);
    const back = server(
      `SELECT ST_AsGeoJSON(ST_CurveToLine(t.v::geometry)) FROM unnest(ARRAY['${ARC_HEX}']::text[])`,
      {},
    );
    expect(back !== "auth" && back.rows?.[1]).toEqual([ARC_AS_LINE]);
    readBack(layer, [4], [ARC_AS_LINE]);
    expect(summaryOf(layer)).toMatchObject({
      rows: 6,
      shapes: 5,
      srid: 4326,
      failed: 0,
      unread: [],
    });
    expect(summaryOf(layer).bounds).toEqual([126.97, 37.53, 127.03, 37.57]);
    const squares = buildLayer(
      set(many).rows.map((r) => r[1] ?? null),
      "wkb",
    );
    expect(summaryOf(squares)).toMatchObject({ rows: MANY_ROWS, shapes: MANY_ROWS, failed: 0 });
  });
});
