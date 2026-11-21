// The per-run signal of deps.execute, which the value search stops one table's run with, on
// PostgreSQL's sessions (engines/pg-session.js): it cancels that run's statement on that run's
// session alone (db.cancel) and starts nothing after it, while the other runs go on; a signal that
// is already aborted opens no session. A scripted server (the bridge stub's StubDatabase) stands in
// for PostgreSQL.
import { describe, expect, it } from "vitest";
import type { DbColumn, StubDatabase } from "../../../packages/bridge/src/index";
import { sessionExecutor } from "./pg-host";
import { SEARCH_CONNECTION as PG } from "./search-fixture";

const grants = [{ permission: "db:connect" as const, hosts: ["*"] }];
const one: DbColumn = {
  name: "?column?",
  typeOid: 23,
  typeModifier: -1,
  typeSize: -1,
  tableOid: 0,
  columnNumber: 0,
};
const server = (): StubDatabase => ({
  statements: [
    { sql: "select pg_sleep(60)", waits: true },
    { sql: "select 1", columns: [one], rows: [["1"]] },
  ],
});
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((resolve) => setTimeout(resolve, 2));
  expect(ok()).toBe(true);
};

describe("a run's own signal on PostgreSQL's sessions", () => {
  it("cancels that run's statement on its session alone; the other run goes on", async () => {
    const t = sessionExecutor(server(), { grants });
    const mine = new AbortController();
    const stopped = t.execute(PG, "select pg_sleep(60);\nselect 1", {
      catalog: true,
      signal: mine.signal,
    });
    const other = t.execute(PG, "select pg_sleep(60)", { catalog: true });
    await until(() => t.made("db.run").length === 2);
    const [first, second] = t.made("db.run").map((p) => p.sessionId);
    expect(first).not.toBe(second);

    mine.abort();
    const done = await stopped;
    expect(done.result.statements.map((s) => [s.ran, s.error?.kind])).toEqual([
      [true, "cancelled"],
      [false, undefined],
    ]);
    expect(t.made("db.cancel")).toEqual([{ sessionId: first }]);
    // The other run still waits on its session; nothing after the cancelled statement ran.
    expect(t.sessions.running()).toBe(1);
    expect(t.made("db.run").map((p) => p.sql)).toEqual([
      "select pg_sleep(60)",
      "select pg_sleep(60)",
    ]);

    t.sessions.cancel();
    expect((await other).result.statements[0]?.error?.kind).toBe("cancelled");
    expect(t.made("db.cancel")).toEqual([{ sessionId: first }, { sessionId: second }]);
    expect(t.made("db.close").map((p) => p.sessionId)).toEqual([first, second]);
  });

  it("between statements, stops the next; aborted before the run, opens no session", async () => {
    const between = new AbortController();
    const t = sessionExecutor(
      {
        statements: [],
        // The server answers the first statement as the signal aborts: the second never starts.
        answer: (sql) => {
          if (sql === "select 1") between.abort();
          return { sql, columns: [one], rows: [[sql.slice(-1)]] };
        },
      },
      { grants },
    );
    const done = await t.execute(PG, "select 1;\nselect 2", {
      catalog: true,
      signal: between.signal,
    });
    expect(done.result.statements.map((s) => [s.ran, s.error?.kind])).toEqual([
      [true, undefined],
      [false, undefined],
    ]);
    expect(t.made("db.run").map((p) => p.sql)).toEqual(["select 1"]);

    const before = new AbortController();
    before.abort();
    const refused = await t.execute(PG, "select 1", { catalog: true, signal: before.signal });
    expect(refused.result.error).toMatchObject({ kind: "cancelled", message: "Cancelled." });
    expect(t.made("db.open")).toHaveLength(1);
  });
});
