// What the grid draws without the DOM: the order on screen (sort, quick filter, added rows last)
// with pending changes in, the value viewer's readings, and what a drop on the surface does.
import { describe, expect, it } from "vitest";
import { dropAction } from "../ui/drops.js";
import { addRow, editCell, emptyChanges, targetOf } from "../ui/edit/pending.js";
import { rowOrder, rowsShown } from "../ui/grid-model.js";
import { describeValue, hexDump } from "../ui/value.js";

const set = {
  columns: ["id", "name"],
  rows: [
    ["10", "pear"],
    ["9", null],
    ["11", "apple"],
  ] as (string | null)[][],
  truncated: false,
};
const columns = [
  { name: "id", type: "int", primary: true },
  { name: "name", type: "text", primary: false },
];

describe("the grid's rows", () => {
  it("sorts numbers by value with NULL last, filters by text, and keeps added rows at the end", () => {
    expect(rowOrder(set, null, { column: 0, direction: "asc" }, "")).toEqual([1, 0, 2]);
    expect(rowOrder(set, null, { column: 1, direction: "desc" }, "")).toEqual([0, 2, 1]);
    expect(rowOrder(set, null, null, "APP")).toEqual([2]);
    expect(rowOrder(set, null, null, "null")).toEqual([1]);
    const target = targetOf("sqlite", { schema: "main", name: "t" }, set.columns, columns).target;
    if (!target) throw new Error("no target");
    const changes = emptyChanges();
    editCell(changes, target, set, 1, 1, "zebra");
    const added = addRow(changes, target, set);
    expect(rowOrder(set, changes, { column: 1, direction: "asc" }, "")).toEqual([2, 0, 1, added]);
    expect(rowsShown(set, changes, [1, added])).toEqual([
      ["9", "zebra"],
      [null, null],
    ]);
  });
});

describe("the value viewer", () => {
  it("lays JSON out, dumps bytes, and says NULL and '' in words", () => {
    const json = describeValue('{"a":[1,2]}', "jsonb");
    expect(json.views).toEqual(["json", "text"]);
    expect(json.text("json")).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(json.meta).toBe("jsonb · 11 characters, 11 bytes");
    const bytes = describeValue("0x48690A", "bytea");
    expect(bytes.views[0]).toBe("hex");
    expect(bytes.text("hex")).toBe(`00000000  48 69 0a${" ".repeat(39)}  Hi.`);
    expect(bytes.meta).toBe("bytea · 3 bytes");
    expect(describeValue(null).meta).toBe("NULL");
    expect(describeValue("").meta).toBe("'' (an empty string)");
    expect(hexDump("00".repeat(17)).split("\n")).toHaveLength(2);
  });
});

describe("drops", () => {
  it("opens a SQLite file, puts SQL in the console and imports a CSV, TSV or JSON file", () => {
    expect(dropAction({ kind: "file", path: "/d/app.sqlite3" })).toEqual({
      kind: "visit",
      path: "/d/app.sqlite3",
    });
    expect(dropAction({ kind: "file", path: "/d/q.sql", text: "select 1" })).toEqual({
      kind: "insert",
      text: "select 1",
    });
    expect(dropAction({ kind: "text", text: "select 2" })).toEqual({
      kind: "insert",
      text: "select 2",
    });
    expect(dropAction({ kind: "file", path: "/d/q.sql" })).toEqual({
      kind: "console",
      path: "/d/q.sql",
    });
    for (const format of ["csv", "tsv", "json"])
      expect(dropAction({ kind: "file", path: `/d/rows.${format.toUpperCase()}` })).toEqual({
        kind: "import",
        path: `/d/rows.${format.toUpperCase()}`,
        format,
      });
    expect(dropAction({ kind: "file", path: "/d/photo.png" })).toMatchObject({ kind: "refuse" });
  });
});
