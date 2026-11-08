// Pending changes (DB-14, ADR 0115): cells, new rows and deleted rows kept apart, then one
// transaction of statements keyed on the primary key, per dialect; the refusals; a failure that
// rolls everything back.
import { describe, expect, it } from "vitest";
import {
  addRow,
  cellAt,
  countChanges,
  deleteRows,
  editCell,
  emptyChanges,
  planChanges,
  refusalOf,
  revertRows,
  targetOf,
} from "../ui/edit/pending.js";
import { sourceOf } from "../ui/edit/source.js";
import { previewSql, submitChanges } from "../ui/edit/submit.js";
import { literal } from "../ui/edit/values.js";
import { Refusal } from "../ui/execute.js";
import { split } from "../ui/sql/split.js";
import { lite, scriptedExecutor } from "./scripted";

const set = {
  columns: ["id", "name", "note"],
  rows: [
    ["1", "ann", null],
    ["2", "o'brien\\", "x"],
  ] as (string | null)[][],
  truncated: false,
};
const types = {
  postgresql: ["integer", "text", "text"],
  mysql: ["int(11)", "varchar(40)", "text"],
  sqlite: ["INTEGER", "TEXT", "TEXT"],
} as const;
const catalog = (dialect: keyof typeof types) =>
  set.columns.map((name, i) => ({ name, type: types[dialect][i] ?? "", primary: i === 0 }));
const target = (dialect: keyof typeof types) => {
  const made = targetOf(dialect, { schema: "app", name: "people" }, set.columns, catalog(dialect));
  if (!made.target) throw new Error(made.reason);
  return made.target;
};

function changed(dialect: keyof typeof types) {
  const t = target(dialect);
  const changes = emptyChanges();
  editCell(changes, t, set, 1, 1, "it's");
  editCell(changes, t, set, 0, 2, null);
  editCell(changes, t, set, 0, 2, "seen");
  const row = addRow(changes, t, set);
  editCell(changes, t, set, row, 0, "3");
  editCell(changes, t, set, row, 1, "new\\one");
  deleteRows(changes, t, set, [1]);
  return { t, changes };
}

describe("pending changes", () => {
  it("builds one statement per change, keyed on the primary key, for each dialect", () => {
    const pg = changed("postgresql");
    expect(planChanges(pg.t, set, pg.changes).map((c) => c.sql)).toEqual([
      'DELETE FROM "app"."people" WHERE "id" = 2',
      `UPDATE "app"."people" SET "note" = 'seen' WHERE "id" = 1`,
      `INSERT INTO "app"."people" ("id", "name") VALUES (3, E'new\\\\one')`,
    ]);
    const my = changed("mysql");
    expect(planChanges(my.t, set, my.changes).map((c) => c.sql)).toEqual([
      "DELETE FROM `app`.`people` WHERE `id` = 2",
      "UPDATE `app`.`people` SET `note` = 'seen' WHERE `id` = 1",
      "INSERT INTO `app`.`people` (`id`, `name`) VALUES (3, 'new\\\\one')",
    ]);
    const lt = changed("sqlite");
    expect(planChanges(lt.t, set, lt.changes).map((c) => c.sql)).toEqual([
      'DELETE FROM "people" WHERE "id" = 2',
      `UPDATE "people" SET "note" = 'seen' WHERE "id" = 1`,
      `INSERT INTO "people" ("id", "name") VALUES (3, 'new\\one')`,
    ]);
    expect(countChanges(lt.changes)).toBe(3);
    expect(cellAt(lt.changes, set, 1, 1)).toMatchObject({ value: "o'brien\\", deleted: true });
    expect(cellAt(lt.changes, set, 0, 2)).toMatchObject({ value: "seen", changed: true });
    expect(cellAt(lt.changes, set, 2, 1)).toMatchObject({ value: "new\\one", inserted: true });
    expect(previewSql(lt.t, set, lt.changes).split("\n")).toHaveLength(3);
  });

  it("keys a changed primary key on the old value and drops a cell set back to what it was", () => {
    const t = target("postgresql");
    const changes = emptyChanges();
    editCell(changes, t, set, 0, 0, "10");
    editCell(changes, t, set, 1, 2, "y");
    editCell(changes, t, set, 1, 2, "x");
    expect(planChanges(t, set, changes).map((c) => c.sql)).toEqual([
      'UPDATE "app"."people" SET "id" = 10 WHERE "id" = 1',
    ]);
    revertRows(changes, set, undefined);
    expect(countChanges(changes)).toBe(0);
  });

  it("keys on every column of a composite key and writes a row with only defaults", () => {
    const columns = [
      { name: "a", type: "int", primary: true },
      { name: "b", type: "text", primary: true },
      { name: "v", type: "text", primary: false },
    ];
    const pair = { columns: ["v", "b", "a"], rows: [["x", "k", "7"]], truncated: false };
    const made = targetOf("postgresql", { schema: "s", name: "t" }, pair.columns, columns);
    const t = made.target;
    if (!t) throw new Error(made.reason);
    expect(t.key).toEqual([2, 1]);
    const changes = emptyChanges();
    editCell(changes, t, pair, 0, 0, "y");
    addRow(changes, t, pair);
    expect(planChanges(t, pair, changes).map((c) => c.sql)).toEqual([
      `UPDATE "s"."t" SET "v" = 'y' WHERE "a" = 7 AND "b" = 'k'`,
      'INSERT INTO "s"."t" DEFAULT VALUES',
    ]);
    const my = targetOf("mysql", { schema: "s", name: "t" }, pair.columns, columns).target;
    if (!my) throw new Error("no target");
    const blank = emptyChanges();
    addRow(blank, my, pair);
    expect(planChanges(my, pair, blank)[0]?.sql).toBe("INSERT INTO `s`.`t` () VALUES ()");
  });

  it("writes values as literals of the column's type, never as raw text", () => {
    expect(literal("postgresql", "42", "integer")).toBe("42");
    expect(literal("postgresql", "42", "text")).toBe("'42'");
    expect(literal("postgresql", "a'b\\c", "text")).toBe("E'a''b\\\\c'");
    expect(literal("mysql", "a'b\\c", "text")).toBe("'a''b\\\\c'");
    expect(literal("sqlite", "a'b\\c", "TEXT")).toBe("'a''b\\c'");
    expect(literal("postgresql", "\\x00ff", "bytea")).toBe("E'\\\\x00ff'");
    expect(literal("mysql", "0x00FF", "varbinary(4)")).toBe("0x00FF");
    expect(literal("sqlite", "0x00FF", "BLOB")).toBe("X'00FF'");
    expect(literal("sqlite", "0x00FF", "TEXT")).toBe("'0x00FF'");
    expect(literal("sqlite", "007", "")).toBe("'007'");
    expect(literal("mysql", null, "int")).toBe("NULL");
    expect(literal("postgresql", "1; drop table x", "integer")).toBe("'1; drop table x'");
  });

  it("refuses edits for a result without a primary key", () => {
    const columns = set.columns.map((name) => ({ name, type: "text", primary: false }));
    const made = targetOf("sqlite", { schema: "main", name: "log" }, set.columns, columns);
    expect(refusalOf(lite(), made.target)).toMatch(/log has no primary key/u);
    const t = made.target;
    if (!t) throw new Error("no target");
    expect(() => editCell(emptyChanges(), t, set, 0, 1, "x")).toThrow(/no primary key/u);
    const partial = targetOf(
      "sqlite",
      { schema: "main", name: "people" },
      ["name"],
      catalog("sqlite"),
    );
    expect(partial.target).toBeUndefined();
    expect(partial.reason).toMatch(/lacks id/u);
    const join = split("select p.id, q.name from people p join q on q.id = p.id", "sqlite")[0];
    expect(join && sourceOf(join, "sqlite")).toBeUndefined();
    const plain = split('select * from "My ""T""" where id > 1 order by id', "postgresql")[0];
    expect(plain && sourceOf(plain, "postgresql")).toEqual({ schema: null, name: 'My "T"' });
    const qualified = split("SELECT id FROM App.People p LIMIT 5", "postgresql")[0];
    expect(qualified && sourceOf(qualified, "postgresql")).toEqual({
      schema: "app",
      name: "people",
    });
  });

  it("refuses edits on a read-only connection, before any client runs", async () => {
    expect(refusalOf(lite({ readOnly: true }), target("sqlite"))).toBe(
      "Notes is read-only: its rows cannot be changed here.",
    );
    const { execute, ran } = scriptedExecutor(() => ({ changes: 1 }));
    const { t, changes } = changed("sqlite");
    await expect(
      submitChanges({ execute, conn: lite({ readOnly: true }), target: t, set, changes }),
    ).rejects.toBeInstanceOf(Refusal);
    expect(ran).toHaveLength(0);
  });

  it("runs every change in one transaction and rolls back when one fails", async () => {
    const { execute, ran } = scriptedExecutor((sql) =>
      sql.startsWith("UPDATE")
        ? { error: "UNIQUE constraint failed: people.note" }
        : { changes: 1 },
    );
    const { t, changes } = changed("sqlite");
    const done = await submitChanges({ execute, conn: lite(), target: t, set, changes });
    const args = ran[0]?.args ?? [];
    expect(args.indexOf("BEGIN")).toBeGreaterThan(0);
    expect(args.indexOf("BEGIN")).toBeLessThan(args.indexOf('DELETE FROM "people" WHERE "id" = 2'));
    expect(args.at(-1)).toBe("COMMIT");
    expect(done.ok).toBe(false);
    expect(done.failed?.kind).toBe("update");
    expect(done.message).toMatch(/^Rolled back, nothing was changed: row 1 \(update\): /u);
    expect(countChanges(changes)).toBe(3);
  });

  it("commits in one transaction on PostgreSQL and says which rows matched nothing", async () => {
    const { execute, ran } = scriptedExecutor((sql) =>
      sql.startsWith("DELETE") ? { changes: 0 } : { changes: 1 },
    );
    const { t, changes } = changed("postgresql");
    const conn = lite({ engine: "postgresql", file: "", host: "db", name: "Shop" });
    const done = await submitChanges({ execute, conn, target: t, set, changes });
    expect(ran[0]?.args).toContain("--single-transaction");
    expect(done.ok).toBe(true);
    expect(done.message).toMatch(/^Committed 3 changes; row 2 \(delete\) matched no row/u);
  });

  it("asks before changing a production connection", async () => {
    const asked: string[] = [];
    const { execute, ran } = scriptedExecutor(() => ({ changes: 1 }), {
      confirm: () => false,
      asked,
    });
    const { t, changes } = changed("sqlite");
    await expect(
      submitChanges({ execute, conn: lite({ tag: "production" }), target: t, set, changes }),
    ).rejects.toThrow(/Not run/u);
    expect(asked).toEqual(["Run 3 statements on Notes?"]);
    expect(ran).toHaveLength(0);
  });
});
