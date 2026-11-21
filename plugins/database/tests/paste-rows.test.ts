// Duplicate, fill down, clear and undo on the pending changes (PG-43, #470, ADR 0115): a duplicated
// row leaves to DEFAULT what the server fills (identity, generated, a sequence's default, a keyed
// default), fill down copies the block's top row below, clear sets NULL, and one undo takes back one
// step, whatever it changed.
import { describe, expect, it } from "vitest";
import { attachEditors } from "../ui/cell-editors/resolve.js";
import { applyCells, fillDownValues, planCells, refusalOf } from "../ui/edit/cells.js";
import { duplicateRows } from "../ui/edit/duplicate.js";
import { createHistory } from "../ui/edit/history.js";
import {
  addRow,
  cellAt,
  countChanges,
  editCell,
  emptyChanges,
  planChanges,
  revertRows,
  targetOf,
} from "../ui/edit/pending.js";
import { DEFAULT } from "../ui/edit/values.js";
import { at, col, pasteSet, pasteTarget } from "./paste-fixture";

describe("duplicate rows", () => {
  it("adds pending rows with the same values, leaving to DEFAULT what the server fills", () => {
    const set = pasteSet();
    const target = pasteTarget(set);
    const changes = emptyChanges();
    editCell(changes, target, set, 1, col("name"), "Bea");
    const done = duplicateRows(changes, target, set, [1, 0]);
    expect(done).toEqual({ added: 2, left: ["id", "twice", "seq"], keys: [] });
    expect(changes.inserts[0]).toEqual([
      undefined,
      "Bea",
      "2026-11-02",
      "20.00",
      "[]",
      undefined,
      "second",
      undefined,
    ]);
    expect(planChanges(target, set, changes).at(-1)?.sql).toBe(
      `INSERT INTO "public"."t" ("name", "due", "amount", "doc", "note") VALUES ('Ada', '2026-11-01'::date, 10.00, '{"a": 1}'::jsonb, 'first')`,
    );
    // A pending row duplicated keeps its DEFAULT; NULL stays NULL.
    const row = addRow(changes, target, set);
    editCell(changes, target, set, row, col("note"), DEFAULT);
    duplicateRows(changes, target, set, [row]);
    expect(changes.inserts.at(-1)?.[col("note")]).toBe(DEFAULT);
    expect(changes.inserts.at(-1)?.[col("due")]).toBeUndefined();
  });

  it("copies a key without a default and names it; SQLite's INTEGER PRIMARY KEY is left out", () => {
    const set = { columns: ["code", "name"], rows: [["a", "x"]], truncated: false };
    const columns = [
      { name: "code", type: "text", nullable: false, default: null, primary: true },
      { name: "name", type: "text", nullable: true, default: null, primary: false },
    ];
    const made = targetOf("postgresql", { schema: "public", name: "c" }, set.columns, columns);
    if (!made.target) throw new Error(made.reason);
    const pg = attachEditors(made.target, columns, new Map());
    const changes = emptyChanges();
    expect(duplicateRows(changes, pg, set, [0])).toEqual({ added: 1, left: [], keys: ["code"] });
    expect(changes.inserts[0]).toEqual(["a", "x"]);

    const lite = [
      { name: "id", type: "INTEGER", nullable: true, default: null, primary: true },
      { name: "name", type: "TEXT", nullable: true, default: null, primary: false },
    ];
    const rows = { columns: ["id", "name"], rows: [["7", "x"]], truncated: false };
    const found = targetOf("sqlite", { schema: "main", name: "n" }, rows.columns, lite);
    if (!found.target) throw new Error(found.reason);
    const sqlite = attachEditors(found.target, lite, new Map());
    expect(duplicateRows(emptyChanges(), sqlite, rows, [0])).toEqual({
      added: 1,
      left: ["id"],
      keys: [],
    });
  });
});

describe("fill down and clear", () => {
  it("fills the block's top row into the rows below it", () => {
    const set = pasteSet();
    const target = pasteTarget(set);
    const changes = emptyChanges();
    const block = at(0, col("name"), { bottom: 2, right: col("due") });
    const fill = fillDownValues(set, changes, block);
    expect(fill.values).toEqual([
      ["Ada", "2026-11-01"],
      ["Ada", "2026-11-01"],
    ]);
    const plan = planCells({ target, set, changes, ...fill });
    applyCells(changes, target, set, plan);
    expect(cellAt(changes, set, 2, col("due")).value).toBe("2026-11-01");
    expect(countChanges(changes)).toBe(2);
    expect(() => fillDownValues(set, changes, at(0, col("name")))).toThrow(
      "Select two rows or more to fill down: the top row's cells go into the rows below.",
    );
  });

  it("clears the selected cells to NULL, refused for a NOT NULL column", () => {
    const set = pasteSet();
    const target = pasteTarget(set);
    const changes = emptyChanges();
    const block = at(0, col("due"), { bottom: 1, right: col("amount") });
    const plan = planCells({ target, set, changes, at: block, values: [[null]] });
    applyCells(changes, target, set, plan);
    expect(cellAt(changes, set, 1, col("amount")).value).toBeNull();
    const notes = at(0, col("name"), { right: col("note") });
    const refused = planCells({ target, set, changes, at: notes, values: [[null]] });
    expect(refusalOf(refused, "cleared")).toBe(
      "Nothing cleared: row 1, twice: twice is generated always from an expression: the server computes it. Hide the column (h) to leave it out. 1 more cell is refused too.",
    );
  });
});

describe("undo of pending changes", () => {
  it("takes back one step at a time, a whole paste in one", () => {
    const set = pasteSet();
    const target = pasteTarget(set);
    const history = createHistory();
    let changes = emptyChanges();
    const step = (fn: () => void) => {
      changes = history.record(changes, fn);
    };
    step(() => editCell(changes, target, set, 0, col("name"), "Ann"));
    step(() => {
      const plan = planCells({
        target,
        set,
        changes,
        at: at(1, col("name")),
        values: [["B"], ["C"], ["D"]],
      });
      applyCells(changes, target, set, plan);
    });
    step(() => revertRows(changes, set, [0]));
    expect(countChanges(changes)).toBe(3);
    changes = history.undo(changes) ?? changes;
    expect(countChanges(changes)).toBe(4);
    changes = history.undo(changes) ?? changes;
    expect(countChanges(changes)).toBe(1);
    expect(changes.inserts).toEqual([]);
    changes = history.undo(changes) ?? changes;
    expect(countChanges(changes)).toBe(0);
    expect(history.undo(changes)).toBeUndefined();
  });

  it("keeps a step only when it changed something, puts it back on a throw, keeps 100", () => {
    const set = pasteSet();
    const target = pasteTarget(set);
    const history = createHistory();
    let changes = emptyChanges();
    changes = history.record(changes, () => editCell(changes, target, set, 0, col("name"), "Ada"));
    expect(history.size()).toBe(0);
    const before = changes;
    expect(() =>
      history.record(changes, () => {
        editCell(changes, target, set, 0, col("name"), "Zed");
        throw new Error("no");
      }),
    ).toThrow("no");
    expect(history.size()).toBe(0);
    expect(before.updates.size).toBe(0);
    for (let i = 0; i < 120; i++)
      changes = history.record(changes, () =>
        editCell(changes, target, set, 0, col("name"), `n${i}`),
      );
    expect(history.size()).toBe(100);
    history.clear();
    expect(history.size()).toBe(0);
  });
});
