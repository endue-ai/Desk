// The agents' read tools (ui/features/audit/tools.js, PG-91) on a scripted PostgreSQL server and a
// scripted SQLite file: what each answers, that each runs on a read-only session, and what each
// refuses (a write explained with ANALYZE, ANALYZE the person has not allowed, a non-PostgreSQL
// connection where only PostgreSQL answers, an object or a table that is not there); a row limit or
// a timeout past the settings is capped, never raised.
import { describe, expect, it } from "vitest";
import { asAgent, auditMount, SHOP } from "./audit-fixture";

const opens = (m: Awaited<ReturnType<typeof auditMount>>["m"]) =>
  m.host.calls
    .filter((c) => c.method === "db.open")
    .map((c) => c.params as unknown as Record<string, unknown>);

describe("explain-statement", () => {
  it("answers the plan of a statement on a read-only session", async () => {
    const { m, seen } = await auditMount();
    const answer = await asAgent(m, "endue.database.explain-statement", {
      connection: "shop",
      sql: "select * from people;",
    });
    expect(answer).toEqual({
      plan: "Seq Scan on people  (cost=0.00..1.03 rows=3 width=40)",
      analyzed: false,
    });
    expect(seen.at(-1)).toMatchObject({
      sql: "EXPLAIN (FORMAT TEXT) select * from people",
      who: { readOnly: "on" },
    });
    expect(opens(m).at(-1)).toMatchObject({ readOnly: true });
  });

  it("runs ANALYZE only where the person allows it, and only of a read", async () => {
    const { m, seen } = await auditMount();
    const sql = "select * from people";
    await expect(
      asAgent(m, "endue.database.explain-statement", { connection: "shop", sql, analyze: true }),
    ).rejects.toThrow(/has not allowed it for agents on shop/u);
    await m.host.command("endue.database.agent-access", { connection: "shop", analyze: true });
    await expect(
      asAgent(m, "endue.database.explain-statement", {
        connection: "shop",
        sql: "delete from people",
        analyze: true,
      }),
    ).rejects.toThrow(/an agent's runs only a read: this one is DELETE/u);
    const answer = await asAgent(m, "endue.database.explain-statement", {
      connection: "shop",
      sql,
      analyze: true,
    });
    expect(answer).toMatchObject({ analyzed: true });
    expect(seen.at(-1)?.sql).toBe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`);
    expect(seen.filter((s) => /^delete/iu.test(s.sql))).toEqual([]);
  });

  it("takes one statement only", async () => {
    const { m } = await auditMount();
    await expect(
      asAgent(m, "endue.database.explain-statement", {
        connection: "shop",
        sql: "select 1; select 2",
      }),
    ).rejects.toThrow(/Hand in one statement: this SQL holds 2/u);
  });
});

describe("object-ddl", () => {
  it("answers an object's DDL, and refuses one that is not there", async () => {
    const { m } = await auditMount();
    const answer = (await asAgent(m, "endue.database.object-ddl", {
      connection: "Notes",
      name: "notes",
    })) as { kind: string; ddl: string };
    expect(answer).toEqual({
      kind: "table",
      ddl: "CREATE TABLE notes (id integer primary key, body text);\n",
    });
    await expect(
      asAgent(m, "endue.database.object-ddl", { connection: "Notes", name: "nosuch" }),
    ).rejects.toThrow(/main has no object named nosuch/u);
  });
});

describe("sample-rows", () => {
  it("answers a table's first rows, 20 by default, capped by the settings' row limit", async () => {
    const { m, seen } = await auditMount({ settings: { "max-rows": 2 } });
    const answer = await asAgent(m, "endue.database.sample-rows", {
      connection: "shop",
      schema: "public",
      table: "people",
      limit: 500,
    });
    expect(seen.at(-1)?.sql).toBe('SELECT * FROM "public"."people" LIMIT 2 OFFSET 0');
    expect(answer).toMatchObject({ columns: ["id", "name", "email"], masked: [] });
    expect((answer as { rows: unknown[] }).rows).toHaveLength(2);
  });

  it("says when the table is not there", async () => {
    const { m } = await auditMount();
    await expect(
      asAgent(m, "endue.database.sample-rows", {
        connection: "shop",
        schema: "public",
        table: "nosuch",
      }),
    ).rejects.toThrow(/does not exist/u);
  });
});

describe("table-stats", () => {
  it("answers a table's size and its columns' statistics", async () => {
    const { m } = await auditMount();
    const answer = (await asAgent(m, "endue.database.table-stats", {
      connection: "shop",
      schema: "public",
      table: "people",
    })) as { table: Record<string, unknown>; columns: Array<Record<string, unknown>> };
    expect(answer.table).toMatchObject({ estimated_rows: "3", total_bytes: "16384" });
    expect(answer.columns.map((c) => c.attname)).toEqual(["email", "id"]);
  });

  it("refuses a table that is not there and a connection that is not PostgreSQL", async () => {
    const { m } = await auditMount();
    await expect(
      asAgent(m, "endue.database.table-stats", {
        connection: "shop",
        schema: "public",
        table: "x",
      }),
    ).rejects.toThrow(/public has no table named x/u);
    await expect(
      asAgent(m, "endue.database.table-stats", { connection: "Notes", schema: "main", table: "x" }),
    ).rejects.toThrow(/reads PostgreSQL's catalog: Notes is a SQLite connection/u);
  });
});

describe("sessions-list", () => {
  it("answers the server's sessions, and only on PostgreSQL", async () => {
    const { m } = await auditMount();
    const answer = (await asAgent(m, "endue.database.sessions-list", { connection: "shop" })) as {
      sessions: Array<Record<string, unknown>>;
    };
    expect(answer.sessions).toEqual([
      expect.objectContaining({
        pid: "4242",
        state: "active",
        query: "SELECT count(*) FROM orders",
      }),
    ]);
    await expect(
      asAgent(m, "endue.database.sessions-list", { connection: "Notes" }),
    ).rejects.toThrow(/PostgreSQL's catalog/u);
  });
});

describe("check-statement", () => {
  it("prepares a statement without running it, and answers an error at its own position", async () => {
    const { m, seen } = await auditMount();
    const ok = await asAgent(m, "endue.database.check-statement", {
      connection: "shop",
      sql: "insert into people (name) values ('Dee')",
    });
    expect(ok).toEqual({ checked: true, ok: true });
    expect(seen.map((s) => s.sql).filter((sql) => /^insert/iu.test(sql))).toEqual([]);
    expect(seen.find((s) => s.sql.startsWith("PREPARE"))?.who).toMatchObject({ readOnly: "on" });
    const bad = await asAgent(m, "endue.database.check-statement", {
      connection: "shop",
      sql: "select * from nosuch",
    });
    expect(bad).toEqual({
      checked: true,
      ok: false,
      error: 'relation "nosuch" does not exist',
      code: "42P01",
      position: 14,
    });
  });

  it("says a statement PostgreSQL cannot prepare was not checked", async () => {
    const { m, seen } = await auditMount();
    const before = seen.length;
    const answer = await asAgent(m, "endue.database.check-statement", {
      connection: "shop",
      sql: "create table t (id int)",
    });
    expect(answer).toMatchObject({ checked: false });
    expect(seen.length).toBe(before);
  });
});

describe("limits", () => {
  it("never lets an agent raise the timeout past the settings", async () => {
    const { m } = await auditMount({ settings: { "timeout-seconds": 5 } });
    await asAgent(m, "endue.database.query", {
      connection: "shop",
      sql: "select 1",
      timeoutSeconds: 600,
    });
    expect(opens(m).at(-1)).toMatchObject({
      readOnly: true,
      settings: expect.objectContaining({ statement_timeout: "5000" }),
    });
    expect(SHOP.readOnly).toBe(false);
  });
});
