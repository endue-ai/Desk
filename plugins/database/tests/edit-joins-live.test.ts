// Editing results by their columns' origins (PG-45, #472) against a real PostgreSQL, when
// ENDUE_DB_TEST_POSTGRES holds a scratch database's URI: through the plugin's edits on the desk
// core's sessions, a join's cells land in the right row of each table; a table without a key with
// two equal rows changes exactly one row by its ctid and refuses the change keyed by its values; a
// row whose ctid moved is refused; a unique NOT NULL index keys a table; an updatable view's row
// changes and a view the server cannot update says why; a self-join stays read-only. After each
// submit the server's rows are read back and compared.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEdits } from "../ui/edits.js";
import { editHarness } from "./edit-joins-harness";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;

describe.skipIf(!uri)("editing joins, tables without a key and views on a real server", () => {
  let made: ReturnType<typeof editHarness> | undefined;
  const live = () => {
    made ??= editHarness(uri ?? "");
    return made;
  };
  const rows = async (sql: string) =>
    (await live().run(sql)).result.statements[0]?.sets[0]?.rows ?? [];
  const edits = () =>
    createEdits({
      catalog: live().catalog,
      execute: live().execute,
      render: () => {},
      reload: (target, conn) => live().reload(target, conn),
    });

  beforeAll(async () => {
    const run = await live().run(
      "drop view if exists t472_big, t472_sums;\n" +
        "drop table if exists t472_orders, t472_people, t472_log, t472_tags;\n" +
        "create table t472_people (id int primary key, name text not null);\n" +
        "create table t472_orders (id int primary key, person int not null references t472_people (id), total numeric(8,2));\n" +
        "create table t472_log (at int, what text);\n" +
        "create table t472_tags (code text not null, label text);\n" +
        "create unique index t472_tags_code on t472_tags (code);\n" +
        "insert into t472_people values (1, 'Ada'), (2, 'Bob');\n" +
        "insert into t472_orders values (10, 1, 5.00), (11, 1, 7.50), (12, 2, 9.00);\n" +
        "insert into t472_log values (1, 'same'), (1, 'same'), (2, 'other');\n" +
        "insert into t472_tags values ('a', 'first'), ('b', 'second');\n" +
        "create view t472_big as select id, person, total, total * 2 as twice from t472_orders where total > 6;\n" +
        "create view t472_sums as select person, sum(total) as total from t472_orders group by person",
    );
    expect(run.result.statements.map((s) => s.error?.message).filter(Boolean)).toEqual([]);
  });
  afterAll(async () => {
    await live().run(
      "drop view if exists t472_big, t472_sums;\n" +
        "drop table if exists t472_orders, t472_people, t472_log, t472_tags",
    );
  });

  it("lands a join's edits in the right row of each table, parents first", async () => {
    const shown = await live().show(
      "select o.id, o.total, p.id as pid, p.name, o.total * 2 as twice from t472_orders o " +
        "join t472_people p on p.id = o.person order by o.id",
    );
    const e = edits();
    const state = await e.ensure(shown, live().conn);
    expect(state.reason).toBe("");
    expect(state.target?.tables?.map((t) => [t.name, t.by])).toEqual([
      ["t472_orders", "primary"],
      ["t472_people", "primary"],
    ]);
    await expect(e.editCell(shown, live().conn, 0, 4, "1")).rejects.toThrow(
      "twice is computed by the query",
    );
    await expect(e.addRow(shown, live().conn)).rejects.toThrow("Rows of a join");
    await e.editCell(shown, live().conn, 0, 1, "6.25");
    await e.editCell(shown, live().conn, 0, 3, "Ada L");
    await e.editCell(shown, live().conn, 1, 3, "Ada L");
    await e.editCell(shown, live().conn, 2, 3, "Bobby");
    expect(e.preview(shown).split("\n")).toEqual([
      `UPDATE "public"."t472_people" SET "name" = 'Ada L' WHERE "id" = 1;`,
      `UPDATE "public"."t472_people" SET "name" = 'Bobby' WHERE "id" = 2;`,
      `UPDATE "public"."t472_orders" SET "total" = 6.25 WHERE "id" = 10;`,
    ]);
    expect(await e.submit(shown, live().conn)).toBe("Committed 3 changes in one transaction.");
    expect(await rows("select id, name from t472_people order by id")).toEqual([
      ["1", "Ada L"],
      ["2", "Bobby"],
    ]);
    expect(await rows("select id, total from t472_orders order by id")).toEqual([
      ["10", "6.25"],
      ["11", "7.50"],
      ["12", "9.00"],
    ]);
  });

  it("says why a join's table without its key in the result cannot change", async () => {
    const shown = await live().show(
      "select o.id, o.total, p.name from t472_orders o join t472_people p on p.id = o.person",
    );
    const e = edits();
    await e.ensure(shown, live().conn);
    await expect(e.editCell(shown, live().conn, 0, 2, "x")).rejects.toThrow(
      "The result lacks id of t472_people's primary key",
    );
  });

  it("changes exactly one of two equal rows by ctid, and refuses the change keyed by values", async () => {
    const byCtid = await live().show("select ctid, * from t472_log order by at, ctid");
    const e = edits();
    expect((await e.ensure(byCtid, live().conn)).target?.tables?.[0]?.by).toBe("ctid");
    await e.editCell(byCtid, live().conn, 0, 2, "changed");
    expect(await e.submit(byCtid, live().conn)).toBe("Committed 1 change in one transaction.");
    expect(await rows("select at, what from t472_log order by at, what")).toEqual([
      ["1", "changed"],
      ["1", "same"],
      ["2", "other"],
    ]);

    await live().run("update t472_log set what = 'same' where what = 'changed'");
    const byValues = await live().show("select * from t472_log order by at");
    const v = edits();
    expect((await v.ensure(byValues, live().conn)).target?.tables?.[0]?.by).toBe("row");
    await v.editCell(byValues, live().conn, 0, 1, "twice");
    await expect(v.submit(byValues, live().conn)).rejects.toThrow(
      "it matched 2 rows of t472_log: its values do not tell it apart",
    );
    await v.editCell(byValues, live().conn, 0, 1, "same");
    await v.editCell(byValues, live().conn, 2, 1, "alone");
    expect(await v.submit(byValues, live().conn)).toBe("Committed 1 change in one transaction.");
    expect(await rows("select at, what from t472_log order by at, what")).toEqual([
      ["1", "same"],
      ["1", "same"],
      ["2", "alone"],
    ]);
  });

  it("refuses a change whose row moved since it was read", async () => {
    const shown = await live().show("select ctid, * from t472_log where at = 2");
    const e = edits();
    await e.editCell(shown, live().conn, 0, 2, "late");
    await live().run("update t472_log set at = at where at = 2");
    await expect(e.submit(shown, live().conn)).rejects.toThrow(
      "it matched no row of t472_log: the row moved",
    );
    expect(await rows("select what from t472_log where at = 2")).toEqual([["alone"]]);
  });

  it("keys a table without a primary key by its unique NOT NULL index", async () => {
    const shown = await live().show("select code, label from t472_tags order by code");
    const e = edits();
    expect((await e.ensure(shown, live().conn)).target?.tables?.[0]?.by).toBe("unique");
    await e.editCell(shown, live().conn, 1, 1, "two");
    expect(e.preview(shown)).toBe(
      `UPDATE "public"."t472_tags" SET "label" = 'two' WHERE "code" = 'b';`,
    );
    await e.submit(shown, live().conn);
    expect(await rows("select code, label from t472_tags order by code")).toEqual([
      ["a", "first"],
      ["b", "two"],
    ]);
  });

  it("changes a row through a view the server can update, and says why it cannot another", async () => {
    const shown = await live().show("select * from t472_big order by id");
    const e = edits();
    const state = await e.ensure(shown, live().conn);
    expect(state.target?.tables?.map((t) => [t.name, t.kind, t.by])).toEqual([
      ["t472_big", "view", "row"],
    ]);
    await expect(e.editCell(shown, live().conn, 0, 3, "1")).rejects.toThrow(
      "twice is computed by view t472_big",
    );
    await e.editCell(shown, live().conn, 1, 2, "8.00");
    await e.submit(shown, live().conn);
    expect(await rows("select id, total from t472_orders order by id")).toEqual([
      ["10", "6.25"],
      ["11", "8.00"],
      ["12", "9.00"],
    ]);

    const sums = await live().show("select * from t472_sums");
    const refused = await edits().ensure(sums, live().conn);
    expect(refused.status).toBe("refused");
    expect(refused.reason).toContain("View t472_sums cannot be updated");
  });

  it("keeps a self-join read-only: which row a column shows is not certain", async () => {
    const shown = await live().show(
      "select a.id, b.name from t472_people a join t472_people b on b.id = a.id",
    );
    const state = await edits().ensure(shown, live().conn);
    expect(state.status).toBe("refused");
    expect(state.reason).toContain("t472_people is read more than once in this query");
  });
});
