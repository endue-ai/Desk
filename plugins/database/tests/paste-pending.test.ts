// A paste on the pending changes (PG-43, #470, ADR 0115): cells from the caret over the shown columns
// in screen order, rows past the last added as pending rows, one value into every selected cell,
// each value read by its column's type (PG-40) and the whole paste refused, with the row and the
// column named, when one is bad.
import { describe, expect, it } from "vitest";
import { applyCells, PASTE_ASK, planCells, refusalOf } from "../ui/edit/cells.js";
import { cellAt, countChanges, deleteRows, emptyChanges, planChanges } from "../ui/edit/pending.js";
import { at, col, pasteSet, pasteTarget } from "./paste-fixture";

function pasted(values: (string | null)[][], where: ReturnType<typeof at>) {
  const set = pasteSet();
  const target = pasteTarget(set);
  const changes = emptyChanges();
  const plan = planCells({ target, set, changes, at: where, values });
  return { set, target, changes, plan };
}

describe("a paste on the pending changes", () => {
  it("fills 3 x 4 cells from the caret over the shown columns, two rows changed and two added", () => {
    // Screen order: amount pinned first, then name, due, doc; twice and the rest hidden.
    const columns = [col("amount"), col("name"), col("due"), col("doc")];
    const values = [
      ["Ann", "2026-12-01", '{"b": 2}'],
      ["Bo", "2026-12-02", "[1]"],
      ["Cat", "2026-12-03", "null"],
      ["Dan", "", '{"d": 4}'],
    ];
    // The grid is sorted: screen row 1 is result row 2, screen row 2 result row 0.
    const where = at(1, 1, { order: [1, 2, 0], columns });
    const { set, target, changes, plan } = pasted(values, where);
    expect(plan.bad).toEqual([]);
    expect(plan).toMatchObject({ added: 2, rows: 4, width: 3, header: false });
    expect(plan.cells).toHaveLength(12);
    applyCells(changes, target, set, plan);
    expect(countChanges(changes)).toBe(4);
    expect(cellAt(changes, set, 2, col("name"))).toMatchObject({ value: "Ann", changed: true });
    expect(cellAt(changes, set, 0, col("due"))).toMatchObject({ value: "2026-12-02" });
    expect(cellAt(changes, set, 3, col("doc"))).toMatchObject({ value: "null", inserted: true });
    // An empty field in a typed column is NULL; the columns not pasted keep their defaults.
    expect(changes.inserts[1]?.[col("due")]).toBeNull();
    expect(changes.inserts[1]?.[col("amount")]).toBeUndefined();
    expect(planChanges(target, set, changes).map((c) => c.sql)).toEqual([
      `UPDATE "public"."t" SET "name" = 'Bo', "due" = '2026-12-02'::date, "doc" = '[1]'::jsonb WHERE "id" = 1`,
      `UPDATE "public"."t" SET "name" = 'Ann', "due" = '2026-12-01'::date, "doc" = '{"b": 2}'::jsonb WHERE "id" = 3`,
      `INSERT INTO "public"."t" ("name", "due", "doc") VALUES ('Cat', '2026-12-03'::date, 'null'::jsonb)`,
      `INSERT INTO "public"."t" ("name", "due", "doc") VALUES ('Dan', NULL, '{"d": 4}'::jsonb)`,
    ]);
  });

  it("puts one value into every selected cell", () => {
    const where = at(0, col("name"), { bottom: 2, right: col("name") });
    const { set, target, changes, plan } = pasted([["same"]], where);
    expect(plan).toMatchObject({ added: 0, rows: 3, width: 1 });
    applyCells(changes, target, set, plan);
    expect([0, 1, 2].map((r) => cellAt(changes, set, r, col("name")).value)).toEqual([
      "same",
      "same",
      "same",
    ]);
  });

  it("refuses the whole paste for one bad value, naming its row and column, with nothing pending", () => {
    const where = at(0, col("due"));
    const { changes, plan } = pasted([["2026-12-01"], ["2026-13-01"], ["2026-02-30"]], where);
    expect(plan.bad.map((b) => [b.row, b.column])).toEqual([
      ["row 2", "due"],
      ["row 3", "due"],
    ]);
    expect(refusalOf(plan, "pasted")).toBe(
      "Nothing pasted: row 2, due: Month 13 does not exist: a month is 01 to 12. 1 more cell is refused too.",
    );
    expect(countChanges(changes)).toBe(0);
  });

  it("refuses NULL in a NOT NULL column, a generated column and a deleted row by name", () => {
    expect(refusalOf(pasted([[null]], at(0, col("note"))).plan, "pasted")).toBe(
      "Nothing pasted: row 1, note: note is NOT NULL: give it a value.",
    );
    // The text \N is text once read; an empty field in a text column is the empty text.
    expect(pasted([["\\N"], [""]], at(0, col("note"))).plan.bad).toEqual([]);
    expect(refusalOf(pasted([["9"]], at(1, col("twice"))).plan, "pasted")).toBe(
      "Nothing pasted: row 2, twice: twice is generated always from an expression: the server computes it. Hide the column (h) to leave it out.",
    );
    const set = pasteSet();
    const target = pasteTarget(set);
    const changes = emptyChanges();
    deleteRows(changes, target, set, [1]);
    const plan = planCells({ target, set, changes, at: at(1, col("name")), values: [["x"]] });
    expect(refusalOf(plan, "pasted")).toBe(
      "Nothing pasted: row 2, name: the row is deleted: restore it first (u).",
    );
  });

  it("reads each value by its column's type and keeps what the type writes", () => {
    const { set, target, changes, plan } = pasted([[" 12.5 ", "{}"]], at(0, col("amount")));
    expect(plan.bad).toEqual([]);
    applyCells(changes, target, set, plan);
    expect(cellAt(changes, set, 0, col("amount")).value).toBe("12.5");
    expect(refusalOf(pasted([["ten"]], at(0, col("amount"))).plan, "pasted")).toMatch(
      /^Nothing pasted: row 1, amount: ten is not a number/u,
    );
    expect(refusalOf(pasted([["{oops"]], at(0, col("doc"))).plan, "pasted")).toMatch(
      /^Nothing pasted: row 1, doc: /u,
    );
  });

  it("leaves out a first line that names the columns it lands on", () => {
    const values = [
      ["Name", "due"],
      ["Eve", "2026-12-24"],
    ];
    const { set, target, changes, plan } = pasted(values, at(2, col("name")));
    expect(plan).toMatchObject({ header: true, rows: 1, added: 0 });
    applyCells(changes, target, set, plan);
    expect(cellAt(changes, set, 2, col("name")).value).toBe("Eve");
  });

  it("refuses a paste wider than the columns on screen from the caret", () => {
    const columns = [col("name"), col("due")];
    const { plan } = pasted([["a", "b", "c"]], at(0, 0, { columns }));
    expect(refusalOf(plan, "pasted")).toBe(
      "Nothing pasted: the paste is 3 columns wide, and from name 2 columns are on screen.",
    );
  });

  it("keeps a short line's missing cells as they were and counts what asks first", () => {
    const { set, target, changes, plan } = pasted([["a", "2026-12-01"], ["b"]], at(0, 1));
    applyCells(changes, target, set, plan);
    expect(cellAt(changes, set, 1, col("due"))).toMatchObject({ changed: false });
    expect(plan.cells).toHaveLength(3);
    expect(PASTE_ASK).toBe(1000);
  });

  it("refuses to apply a plan made before the pending rows changed", () => {
    const { set, target, changes, plan } = pasted([["x"], ["y"], ["z"], ["w"]], at(0, 1));
    changes.inserts.push(target.columns.map(() => undefined));
    expect(() => applyCells(changes, target, set, plan)).toThrow(/changed/u);
  });
});
