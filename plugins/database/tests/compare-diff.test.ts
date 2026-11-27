// Two results compared (PG-26, ADR 0329), without a DOM: rows paired by the primary key when both
// results carry one, else by row position; added, removed and changed rows with the changed cells;
// the columns only one side has listed; a repeated key paired in order; the comparison bounded in
// what it takes and what it keeps; and the difference as a result of its own, in every format.
import { describe, expect, it } from "vitest";
import { compareSets, differenceSet, tooLarge } from "../ui/compare/diff.js";
import { FORMATS, formatRows } from "../ui/results.js";

type Rows = (string | null)[][];
const side = (columns: string[], rows: Rows) => ({ columns, rows });

const BEFORE = side(
  ["id", "item", "price"],
  [
    ["1", "pen", "2.50"],
    ["2", "ink", "4.00"],
    ["3", "pad", "3.20"],
    ["4", "clip", null],
  ],
);
const AFTER = side(
  ["id", "item", "price", "shelf"],
  [
    ["1", "pen", "2.50", "A"],
    ["2", "ink", "4.40", "A"],
    ["4", "clip", "", "B"],
    ["5", "tape", "1.90", "B"],
  ],
);

describe("two results compared", () => {
  it("keys by the primary key when both results carry one: added, removed and changed rows, and the changed cells", () => {
    const d = compareSets(BEFORE, AFTER, ["id"]);
    expect(d.by).toBe("key");
    expect(d.key).toEqual(["id"]);
    expect(d.counts).toEqual({ added: 1, removed: 1, changed: 2, same: 1 });
    expect(d.total).toBe(4);
    expect(d.rows.map((r) => [r.change, r.at, r.cells])).toEqual([
      ["changed", "2", [2]],
      // NULL and '' are not the same value.
      ["changed", "4", [2]],
      ["added", "5", []],
      ["removed", "3", []],
    ]);
    // Values line up with the columns both have, then those only one side has.
    expect(d.rows[0]?.before).toEqual(["2", "ink", "4.00", null]);
    expect(d.rows[0]?.after).toEqual(["2", "ink", "4.40", "A"]);
    expect(d.rows[3]).toMatchObject({ before: ["3", "pad", "3.20", null], after: null });
  });

  it("keys by row position when either result carries no primary key, and says so", () => {
    const d = compareSets(BEFORE, AFTER, null);
    expect(d.by).toBe("position");
    expect(d.key).toEqual([]);
    expect(d.counts).toEqual({ added: 0, removed: 0, changed: 3, same: 1 });
    expect(d.rows.map((r) => [r.change, r.at, r.cells])).toEqual([
      ["changed", "2", [2]],
      ["changed", "3", [0, 1, 2]],
      ["changed", "4", [0, 1, 2]],
    ]);
    const longer = compareSets(side(["a"], [["1"], ["2"], ["3"]]), side(["a"], [["1"]]), []);
    expect(longer.rows.map((r) => [r.change, r.at])).toEqual([
      ["removed", "2"],
      ["removed", "3"],
    ]);
  });

  it("lists the columns only one side has and compares the others by name", () => {
    const before = side(["id", "old", "id", "name"], [["1", "x", "7", "Ada"]]);
    const after = side(["name", "id", "id", "new"], [["Ada", "1", "8", "y"]]);
    const d = compareSets(before, after, ["id"]);
    expect(d.common).toEqual(["name", "id", "id#2"]);
    expect(d.onlyBefore).toEqual(["old"]);
    expect(d.onlyAfter).toEqual(["new"]);
    expect(d.rows).toEqual([
      {
        change: "changed",
        at: "1",
        before: ["Ada", "1", "7", "x", null],
        after: ["Ada", "1", "8", null, "y"],
        cells: [2],
      },
    ]);
    expect(() => compareSets(before, after, ["old"])).toThrow(
      "The key old is not a column of both results.",
    );
  });

  it("pairs a repeated key in order and counts the repeats", () => {
    const before = side(
      ["id", "v"],
      [
        ["1", "a"],
        ["1", "b"],
        [null, "n"],
      ],
    );
    const after = side(
      ["id", "v"],
      [
        ["1", "a"],
        ["1", "c"],
        ["1", "d"],
        [null, "n"],
      ],
    );
    const d = compareSets(before, after, ["id"]);
    expect(d.repeated).toBe(3);
    expect(d.counts).toEqual({ added: 1, removed: 0, changed: 1, same: 2 });
    expect(d.rows.map((r) => [r.change, r.at, r.after?.[1]])).toEqual([
      ["changed", "1", "c"],
      ["added", "1", "d"],
    ]);
  });

  it("refuses past the size bound with a message that says how to compare, and keeps the first differences with exact counts", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => [String(i), `v${i}`]);
    const big = side(["id", "v"], rows(6));
    expect(tooLarge(big, side(["id"], [["1"]]), 12)).toBe("");
    expect(tooLarge(big, side(["id"], [["1"]]), 10)).toBe(
      "Too large to compare: the result before has 12 cells (6 rows of 2 columns), and a comparison takes at most 10 cells a side. Narrow both queries to fewer rows or columns and compare again.",
    );
    expect(tooLarge(side(["id"], [["1"]]), big, 10)).toMatch(
      /^Too large to compare: the result after has 12 cells/u,
    );
    const d = compareSets(side(["id", "v"], []), big, ["id"], { keep: 2 });
    expect(d.counts.added).toBe(6);
    expect(d.total).toBe(6);
    expect(d.rows.map((r) => r.at)).toEqual(["0", "1"]);
  });

  it("writes the difference as a result of its own in every format", () => {
    const set = differenceSet(compareSets(BEFORE, AFTER, ["id"]));
    expect(set.columns).toEqual(["change", "id", "item", "price", "shelf"]);
    expect(formatRows(set, "csv").split("\r\n")).toEqual([
      "change,id,item,price,shelf",
      "changed (before),2,ink,4.00,",
      "changed (after),2,ink,4.40,A",
      "changed (before),4,clip,,",
      'changed (after),4,clip,"",B',
      "added,5,tape,1.90,B",
      "removed,3,pad,3.20,",
    ]);
    expect(set.truncated).toBe(false);
    for (const format of FORMATS) expect(formatRows(set, format), format).toContain("tape");
    // A result with a column named change keeps it: the difference's own column moves aside.
    const named = differenceSet(
      compareSets(side(["change"], [["x"]]), side(["change"], [["y"]]), []),
    );
    expect(named.columns).toEqual(["_change", "change"]);
    const cut = differenceSet(compareSets(BEFORE, AFTER, ["id"], { keep: 1 }));
    expect(cut.rows).toHaveLength(2);
    expect(cut.truncated).toBe(true);
  });
});
