// Pending changes of a result mapped by origins (PG-45, #472, ADR 0350): one UPDATE per table of a
// join, each keyed on its own key, parents first; one row of a table changed from two rows of the
// join is one statement, two values for one of its cells are refused; a change keyed by ctid or by
// its values is guarded to change exactly one row, and a Submit whose guard fails rolls back with
// the reason; a join takes no new or deleted rows, a view what the server allows.
import { describe, expect, it } from "vitest";
import { originTarget, type Relation } from "../ui/edit/origin-target.js";
import {
  addRow,
  deleteRows,
  editCell,
  emptyChanges,
  planChanges,
  type Target,
} from "../ui/edit/pending.js";
import { submitChanges } from "../ui/edit/submit.js";

const col = (attnum: number, name: string, type = "text") => ({
  attnum,
  name,
  type,
  notNull: false,
  default: null,
  updatable: true,
});
const rel = (oid: number, name: string, more: Partial<Relation> = {}): Relation => ({
  oid,
  schema: "public",
  name,
  relkind: "r",
  updatable: 28,
  columns: [col(1, "id", "integer"), col(2, "name")],
  keys: [{ primary: true, name: `${name}_pkey`, columns: [1] }],
  references: [],
  ...more,
});
const ORDERS = rel(100, "orders", {
  columns: [col(1, "id", "integer"), col(2, "person", "integer"), col(3, "total", "numeric")],
  references: [200],
});
const PEOPLE = rel(200, "people");
const LOG = rel(300, "log", { keys: [], columns: [col(1, "at", "integer"), col(2, "what")] });
const VIEW = rel(400, "big", { relkind: "v", updatable: 4, keys: [] });

const targetOf = (
  origins: [string, number, number][],
  rows: (string | null)[][],
  ...rels: Relation[]
) => {
  const set = {
    columns: origins.map(([n]) => n),
    rows,
    truncated: false,
    origins: origins.map(([, table, column]) => ({ table, column })),
  };
  const target: Target = originTarget(set, new Map(rels.map((r) => [r.oid, r])), () => false);
  return { set, target };
};
const join = () =>
  targetOf(
    [
      ["id", 100, 1],
      ["total", 100, 3],
      ["pid", 200, 1],
      ["name", 200, 2],
    ],
    [
      ["10", "5.00", "1", "Ada"],
      ["11", "7.50", "1", "Ada"],
      ["12", "9.00", null, null],
    ],
    ORDERS,
    PEOPLE,
  );
const conn = {
  id: "c",
  name: "shop",
  engine: "postgresql",
  readOnly: false,
  tag: "none",
} as never;

/** An executor whose run fails at statement `at` with `message`, else changes one row each. */
const failing = (at: number, message: string, code = "22P02") =>
  (async (_conn: unknown, sql: string, options: { statements?: unknown[] } = {}) => {
    const n = options.statements?.length ?? 1;
    const statements = Array.from({ length: n }, (_, i) => ({
      index: i,
      ran: i <= at || at < 0,
      sets: [],
      affected: 1,
      warnings: 0,
      notices: [],
      ...(i === at ? { error: { kind: "sql", code, message } } : {}),
    }));
    return { sql, result: { statements, notices: [], ms: 1 } };
  }) as never;

describe("pending changes of a result mapped by origins", () => {
  it("one submit writes each table's UPDATE keyed on its own key, parents first", () => {
    const { set, target } = join();
    const changes = emptyChanges();
    editCell(changes, target, set, 0, 1, "6.25");
    editCell(changes, target, set, 0, 3, "Ada L");
    editCell(changes, target, set, 1, 3, "Ada L");
    expect(planChanges(target, set, changes).map((c) => c.sql)).toEqual([
      `UPDATE "public"."people" SET "name" = 'Ada L' WHERE "id" = 1`,
      `UPDATE "public"."orders" SET "total" = 6.25 WHERE "id" = 10`,
    ]);
    editCell(changes, target, set, 1, 3, "Other");
    expect(() => planChanges(target, set, changes)).toThrow(
      "Rows 1 and 2 are one row of people and change its name to two values: keep one.",
    );
    expect(() => editCell(changes, target, set, 2, 3, "Cy")).toThrow(
      "This row's id of people is NULL, so its row of people cannot be told apart.",
    );
    editCell(changes, target, set, 2, 1, "1.00");
    expect(planChanges(target, set, emptyChanges())).toEqual([]);
  });

  it("a change keyed by ctid or by its values must match exactly one row", () => {
    const byCtid = targetOf(
      [
        ["ctid", 300, -1],
        ["at", 300, 1],
        ["what", 300, 2],
      ],
      [["(0,1)", "1", null]],
      LOG,
    );
    const changes = emptyChanges();
    editCell(changes, byCtid.target, byCtid.set, 0, 2, "it's");
    const [change] = planChanges(byCtid.target, byCtid.set, changes);
    expect(change?.sql).toBe(
      `WITH changed AS (UPDATE "public"."log" SET "what" = 'it''s' WHERE ctid = '(0,1)'::pg_catalog.tid ` +
        `AND pg_catalog.format('%s', "at") = '1' AND "what" IS NULL RETURNING 1) ` +
        "SELECT CASE WHEN pg_catalog.count(*) = 1 THEN 1 ELSE " +
        "(pg_catalog.count(*)::text || ' rows matched')::int END FROM changed",
    );
    expect(change?.guarded).toBe("log");
    const span = change?.cells[0];
    expect(change?.sql.slice(span?.start, span?.end)).toBe("'it''s'");
    const byRow = targetOf(
      [
        ["at", 300, 1],
        ["what", 300, 2],
      ],
      [["1", "same"]],
      LOG,
    );
    const gone = emptyChanges();
    deleteRows(gone, byRow.target, byRow.set, [0]);
    expect(planChanges(byRow.target, byRow.set, gone)[0]?.sql).toMatch(
      /^WITH changed AS \(DELETE FROM "public"\."log" WHERE pg_catalog\.format\('%s', "at"\) = '1' AND pg_catalog\.format\('%s', "what"\) = 'same' RETURNING 1\)/u,
    );
  });

  it("rolls a guarded Submit back, saying whether the row moved or matched more than one", async () => {
    const { set, target } = targetOf(
      [
        ["at", 300, 1],
        ["what", 300, 2],
      ],
      [
        ["1", "same"],
        ["2", "other"],
      ],
      LOG,
    );
    const changes = emptyChanges();
    editCell(changes, target, set, 0, 1, "x");
    editCell(changes, target, set, 1, 1, "y");
    const two = await submitChanges({
      execute: failing(0, 'invalid input syntax for type integer: "2 rows matched"'),
      conn,
      target,
      set,
      changes,
    });
    expect(two.ok).toBe(false);
    expect(two.message).toBe(
      "Rolled back, nothing was changed: row 1 (update): it matched 2 rows of log: its values do not tell it apart from another row. Select a key or ctid to change one of them.",
    );
    const none = await submitChanges({
      execute: failing(1, 'invalid input syntax for type integer: "0 rows matched"'),
      conn,
      target,
      set,
      changes,
    });
    expect(none.message).toBe(
      "Rolled back, nothing was changed: row 2 (update): it matched no row of log: the row moved or went since it was read (its ctid changes on every update). Read the rows again.",
    );
  });

  it("says a foreign key that holds against changes to several tables", async () => {
    const { set, target } = join();
    const changes = emptyChanges();
    editCell(changes, target, set, 0, 0, "13");
    editCell(changes, target, set, 0, 2, "3");
    const done = await submitChanges({
      execute: failing(
        0,
        'update or delete on table "people" violates foreign key constraint',
        "23503",
      ),
      conn,
      target,
      set,
      changes,
    });
    expect(done.message).toMatch(
      /violates foreign key constraint\. A foreign key between orders and people holds against these changes in one Submit: submit them apart\.$/u,
    );
  });

  it("a join takes no new or deleted rows; a view takes what the server allows", () => {
    const { set, target } = join();
    expect(() => addRow(emptyChanges(), target, set)).toThrow(
      "Rows of a join of orders and people cannot be added: open one table for that.",
    );
    expect(() => deleteRows(emptyChanges(), target, set, [0])).toThrow(
      "Rows of a join of orders and people cannot be deleted: open one table for that.",
    );
    const view = targetOf(
      [
        ["id", 400, 1],
        ["name", 400, 2],
      ],
      [["1", "Ada"]],
      VIEW,
    );
    expect(() => addRow(emptyChanges(), view.target, view.set)).toThrow(
      "big takes no added rows: the server refuses them.",
    );
    const one = targetOf(
      [
        ["id", 200, 1],
        ["name", 200, 2],
      ],
      [["1", "Ada"]],
      PEOPLE,
    );
    const changes = emptyChanges();
    const row = addRow(changes, one.target, one.set);
    editCell(changes, one.target, one.set, row, 1, "Cy");
    deleteRows(changes, one.target, one.set, [0]);
    expect(planChanges(one.target, one.set, changes).map((c) => c.sql)).toEqual([
      `DELETE FROM "public"."people" WHERE "id" = 1`,
      `INSERT INTO "public"."people" ("name") VALUES ('Cy')`,
    ]);
  });
});
