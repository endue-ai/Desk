// An agent's query (ui/features/audit/run.js through endue.database.query, PG-91): a read runs on a
// read-only session with its row limit and timeout capped by the settings, SQLite's with -readonly;
// a write is asked with the statement, the connection and its tag, for this run only, every time,
// and a declined one is not run; a write the read-only connection refuses is never asked.
import { describe, expect, it } from "vitest";
import { asAgent, auditMount, SHOP } from "./audit-fixture";

type Asked = { title: string; items: Array<{ id: string; label: string; detail?: string }> };
const words = (asked: Asked | undefined) =>
  (asked?.items ?? []).map((i) => i.detail ?? i.label).join(" | ");

describe("an agent's read", () => {
  it("runs read-only, with the row limit and the timeout under the settings", async () => {
    const { m, seen } = await auditMount({ settings: { "max-rows": 2, "timeout-seconds": 30 } });
    const answer = (await asAgent(m, "endue.database.query", {
      connection: "shop",
      sql: "select id, name, email from people",
      maxRows: 900,
      timeoutSeconds: 3600,
    })) as { statements: Array<{ results: Array<{ rows: unknown[]; truncated: boolean }> }> };
    expect(answer.statements[0]?.results[0]?.rows).toHaveLength(2);
    expect(seen.at(-1)?.who).toMatchObject({ readOnly: "on", statement_timeout: "30000" });
    expect(m.picks).toEqual([]);
  });

  it("opens SQLite read-only too", async () => {
    const { m } = await auditMount();
    await asAgent(m, "endue.database.query", { connection: "Notes", sql: "select 1" });
    const runs = m.clients.spawned.filter(
      (s) => s.command === "sqlite3" && s.args[0] !== "--version",
    );
    expect(runs.at(-1)?.args).toContain("-readonly");
  });

  it("is refused by the server when it would write after all", async () => {
    const { m } = await auditMount();
    const answer = (await asAgent(m, "endue.database.query", {
      connection: "shop",
      sql: "select nextval('people_id_seq')",
    })) as { statements: Array<{ ran: boolean; error?: string; code?: string }> };
    expect(answer.statements[0]).toMatchObject({ code: "25006" });
    expect(answer.statements[0]?.error).toMatch(/read-only transaction/u);
    expect(m.picks).toEqual([]);
  });
});

describe("an agent's write", () => {
  it("is asked with the statement, the connection and its tag, for this run only", async () => {
    const { m, seen } = await auditMount();
    const sql = "insert into people (name) values ('Dee')";
    const answer = await asAgent(m, "endue.database.query", { connection: "shop", sql });
    expect(answer).toMatchObject({ statements: [{ ran: true, affected: 1 }] });
    const asked = m.picks.at(-1) as Asked;
    expect(asked.title).toBe("Run this statement on shop?");
    expect(words(asked)).toBe(
      [
        "An agent asks to change data.",
        "Asked by agent:helper.",
        "shop is tagged staging.",
        "For this run only: the next change asks again.",
        sql,
        "No",
      ].join(" | "),
    );
    expect(seen.at(-1)).toMatchObject({ sql });
    expect(seen.at(-1)?.who.readOnly).toBeUndefined();
    // The next write asks again.
    await asAgent(m, "endue.database.query", { connection: "shop", sql });
    expect(m.picks).toHaveLength(2);
  });

  it("does not run when the person declines", async () => {
    const { m, seen } = await auditMount({ pick: () => "no" });
    await expect(
      asAgent(m, "endue.database.query", {
        connection: "shop",
        sql: "delete from people where id = 1",
      }),
    ).rejects.toThrow(/Not run/u);
    expect(seen.filter((s) => /^delete/iu.test(s.sql))).toEqual([]);
  });

  it("is refused on a read-only connection before anyone is asked", async () => {
    const { m } = await auditMount({
      store: { connections: [{ ...SHOP, readOnly: true }] },
    });
    await expect(
      asAgent(m, "endue.database.query", {
        connection: "shop",
        sql: "update people set name = 'x'",
      }),
    ).rejects.toThrow(/shop is read-only/u);
    expect(m.picks).toEqual([]);
  });
});
