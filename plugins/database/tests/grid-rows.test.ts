// The grid's rows without the DOM (ui/grid/rows.js, ui/grid/worker.js): the order on screen by several
// sort keys and the quick filters, as indexes into the result's rows, and find over the cells on
// screen. The worker answers the same over the columns it was sent.
import { describe, expect, it } from "vitest";
import { addRow, editCell, emptyChanges, targetOf } from "../ui/edit/pending.js";
import { orderOf } from "../ui/grid-model.js";
import { findMatches, nextMatch, orderRows } from "../ui/grid/rows.js";
import { answer } from "../ui/grid/worker.js";

const rows: (string | null)[][] = [
  ["3", "Cy", "b"],
  ["1", "Ada", "a"],
  ["10", "Bob", "b"],
  ["2", null, "a"],
  ["7", "bob", ""],
];
const value = (r: number, c: number) => rows[r]?.[c] ?? null;
const numeric = [true, false, false];
const base = {
  count: rows.length,
  value,
  numeric,
  sort: [],
  filters: [],
  text: "",
  search: [0, 1, 2],
};
type Op = "eq" | "ne" | "gt" | "lt" | "contains" | "empty" | "null" | "notNull";
const kept = (...filters: { column: number; op: Op; value?: string }[]) =>
  orderRows({ ...base, filters: filters.map((f) => ({ value: "", ...f })) });

describe("the grid's order", () => {
  it("sorts by several columns, each in its direction, numbers by value, NULL last, stable", () => {
    const by = (...sort: { column: number; direction: "asc" | "desc" }[]) =>
      orderRows({ ...base, sort });
    expect(by({ column: 2, direction: "asc" }, { column: 0, direction: "desc" })).toEqual([
      4, 3, 1, 2, 0,
    ]);
    expect(by({ column: 0, direction: "asc" })).toEqual([1, 3, 0, 4, 2]);
    // Bob and bob tie (case is ignored), so they keep their order either way; NULL stays last.
    expect(by({ column: 1, direction: "asc" })).toEqual([1, 2, 4, 0, 3]);
    expect(by({ column: 1, direction: "desc" })).toEqual([0, 2, 4, 1, 3]);
    expect(by()).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps the rows each quick filter holds", () => {
    expect(kept({ column: 1, op: "eq", value: "Bob" })).toEqual([2]);
    expect(kept({ column: 0, op: "eq", value: "10.0" })).toEqual([2]);
    expect(kept({ column: 1, op: "ne", value: "Bob" })).toEqual([0, 1, 4]);
    expect(kept({ column: 0, op: "gt", value: "2" })).toEqual([0, 2, 4]);
    expect(kept({ column: 0, op: "lt", value: "3" })).toEqual([1, 3]);
    expect(kept({ column: 1, op: "gt", value: "Bob" })).toEqual([0]);
    expect(kept({ column: 1, op: "contains", value: "O" })).toEqual([2, 4]);
    expect(kept({ column: 2, op: "empty" })).toEqual([4]);
    expect(kept({ column: 1, op: "null" })).toEqual([3]);
    expect(kept({ column: 1, op: "notNull" })).toEqual([0, 1, 2, 4]);
    expect(kept({ column: 2, op: "eq", value: "b" }, { column: 0, op: "gt", value: "5" })).toEqual([
      2,
    ]);
    // The text filter looks only in the columns searched.
    expect(orderRows({ ...base, text: "b", search: [1] })).toEqual([2, 4]);
    expect(orderRows({ ...base, text: "null", search: [1] })).toEqual([3]);
  });

  it("keeps pending changes in and the added rows at the end", () => {
    const set = { columns: ["id", "name", "team"], rows, truncated: false };
    const columns = [
      { name: "id", type: "int", primary: true },
      { name: "name", type: "text", primary: false },
      { name: "team", type: "text", primary: false },
    ];
    const target = targetOf("sqlite", { schema: "main", name: "t" }, set.columns, columns).target;
    if (!target) throw new Error("no target");
    const changes = emptyChanges();
    editCell(changes, target, set, 0, 1, "Bob");
    const added = addRow(changes, target, set);
    const filters = [
      { key: "name", name: "name", op: "eq" as const, value: "Bob", numeric: false },
    ];
    const sort = [{ key: "id", name: "id", direction: "desc" as const }];
    expect(orderOf(set, changes, { sort, filters, text: "", search: [0, 1, 2] })).toEqual([
      2,
      0,
      added,
    ]);
  });

  it("orders 100,000 rows on indexes", () => {
    const many = Array.from({ length: 100_000 }, (_, i) => [
      String(i % 97),
      `n${(i * 7919) % 100_000}`,
    ]);
    const first = many[0];
    const order = orderRows({
      count: many.length,
      value: (r: number, c: number) => many[r]?.[c] ?? null,
      numeric: [true, false],
      sort: [
        { column: 0, direction: "desc" },
        { column: 1, direction: "asc" },
      ],
      filters: [{ column: 0, op: "gt", value: "10" }],
      text: "",
      search: [],
    });
    expect(order.length).toBe(many.filter((r) => Number(r[0]) > 10).length);
    for (let i = 1; i < order.length; i += 997) {
      const a = many[order[i - 1] ?? 0] ?? [];
      const b = many[order[i] ?? 0] ?? [];
      expect(Number(a[0])).toBeGreaterThanOrEqual(Number(b[0]));
    }
    expect(many[0]).toBe(first);
    expect(many).toHaveLength(100_000);
  });
});

describe("find in the grid", () => {
  // Screen order: result rows 2, 0, 4, 3; the columns name, then id.
  const order = [2, 0, 4, 3];
  const search = [1, 0];
  const find = (needle: string, matchCase = false, whole = false, limit = 100) =>
    findMatches({ order, search, value, needle, matchCase, whole, limit });

  it("finds cell text", () => {
    const found = find("b");
    expect(Array.from(found.matches)).toEqual([0, 0, 2, 0]);
    expect(found.count).toBe(2);
    expect(find("B", true).count).toBe(1);
    expect(find("bob", false, true).count).toBe(2);
    expect(find("bo", false, true).count).toBe(0);
    expect(Array.from(find("null").matches)).toEqual([3, 0]);
    expect(find("1").count).toBe(1);
    expect(find("").count).toBe(0);
    // The count is exact past the limit of matches kept.
    const capped = find("o", false, false, 1);
    expect(capped.count).toBe(2);
    expect(capped.matches.length).toBe(2);
    // Next and previous from a cell, wrapping.
    const m = found.matches;
    expect(nextMatch(m, { row: 0, col: 0 }, 1)).toBe(1);
    expect(nextMatch(m, { row: 2, col: 0 }, 1)).toBe(0);
    expect(nextMatch(m, { row: 1, col: 1 }, -1)).toBe(0);
    expect(nextMatch(m, { row: 0, col: 0 }, -1)).toBe(1);
    expect(nextMatch(new Int32Array(0), { row: 0, col: 0 }, 1)).toBe(-1);
  });

  it("the worker orders and finds on the columns it was sent", () => {
    const column = (c: number) => rows.map((row) => row[c] ?? null);
    const sort = [
      { column: 2, direction: "asc" as const },
      { column: 0, direction: "desc" as const },
    ];
    const ordered = answer({
      id: 1,
      kind: "order",
      result: "r1",
      data: { 0: column(0), 2: column(2) },
      count: rows.length,
      numeric,
      sort,
      filters: [],
      text: "",
      search: [],
    });
    expect(ordered.id).toBe(1);
    if (!("order" in ordered)) throw new Error("no order");
    expect(Array.from(ordered.order)).toEqual(orderRows({ ...base, sort }));
    const found = answer({
      id: 2,
      kind: "find",
      result: "r1",
      data: { 1: column(1) },
      order: Int32Array.from(order),
      search,
      needle: "b",
      matchCase: false,
      whole: false,
      limit: 100,
    });
    if (!("matches" in found)) throw new Error("no matches");
    expect(Array.from(found.matches)).toEqual(Array.from(find("b").matches));
    expect(found.count).toBe(2);
    // An edited cell overrides what was sent.
    const edited = answer({
      id: 3,
      kind: "find",
      result: "r1",
      overrides: [[0, 1, "Abe"]],
      order: Int32Array.from(order),
      search,
      needle: "abe",
      matchCase: false,
      whole: true,
      limit: 100,
    });
    expect("matches" in edited && Array.from(edited.matches)).toEqual([1, 0]);
    const plain = { count: rows.length, numeric, sort: [], filters: [], text: "", search: [] };
    expect(
      answer({ ...plain, id: 4, kind: "order", result: "r1", text: "x", search: [3] }),
    ).toEqual({
      id: 4,
      error: "The grid's worker has no column 3 of this result.",
    });
    // Another result starts again from nothing.
    expect(
      answer({ ...plain, id: 5, kind: "order", result: "r2", sort, data: { 2: column(2) } }),
    ).toEqual({ id: 5, error: "The grid's worker has no column 0 of this result." });
  });
});
