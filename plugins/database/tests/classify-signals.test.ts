// A console statement that signals a server session (pg_cancel_backend, pg_terminate_backend) changes
// the server, so the run guards take it as a write (PG-36, ADR 0328, lifting ADR 0290's gap): a
// read-only connection refuses it, a production connection asks, and an agent's run waits for the
// person. EXPLAIN alone does not run it, and a name in a string is not a call.
import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import { createExecutor } from "../ui/execute.js";
import { fromValues } from "../ui/settings.js";
import { classify, readsOnly } from "../ui/sql/classify.js";
import { split } from "../ui/sql/split.js";

const kind = (sql: string, dialect: "postgresql" | "mysql" = "postgresql") =>
  split(sql, dialect).map((s) => classify(s, dialect).kind);

describe("statements that signal a server session", () => {
  it("are writes, wherever the call stands", () => {
    for (const sql of [
      "select pg_cancel_backend(4242)",
      "SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'x'",
      "select count(pg_terminate_backend(pid, 5000)) from pg_stat_activity",
      "with s as (select pid from pg_stat_activity) select pg_cancel_backend(pid) from s",
      "values (pg_cancel_backend(1))",
      "explain analyze select pg_cancel_backend(1)",
    ])
      expect([sql, kind(sql)]).toEqual([sql, ["write"]]);
    for (const sql of [
      "explain select pg_cancel_backend(1)",
      "select 'pg_cancel_backend(1)'",
      "select pg_backend_pid()",
      "select * from pg_stat_activity",
    ])
      expect([sql, kind(sql)]).toEqual([sql, ["read"]]);
    // Only PostgreSQL has them.
    expect(kind("select pg_cancel_backend(1)", "mysql")).toEqual(["read"]);
    const [statement] = split("select pg_terminate_backend(1)", "postgresql");
    expect(readsOnly([classify(statement as never, "postgresql")])).toBe(false);
    // They still return their row.
    expect(classify(statement as never, "postgresql")).toMatchObject({ rows: true, dangerous: "" });
  });

  it("a read-only connection refuses them, production asks, and an agent waits for the person", async () => {
    const run = vi.fn(async () => ({
      statements: [{ index: 0, ran: true, sets: [] }],
      notices: [],
    }));
    const confirm = vi.fn(async () => true);
    const executor = createExecutor({
      runner: { run: async () => ({}) as never },
      output: { read: async () => ({}) as never },
      clients: { get: async () => ({}) as never },
      sessions: { run } as never,
      settings: () => fromValues({}),
      confirm,
      passwords: { get: () => undefined, set: () => {}, ask: async () => undefined },
      cancelled: (message) => new Error(message),
    });
    const conn = (more: Partial<Connection>) =>
      ({ id: "c-1", name: "shop", engine: "postgresql", ...more }) as Connection;
    const sql = "select pg_terminate_backend(4242)";

    await expect(executor.execute(conn({ readOnly: true }), sql)).rejects.toThrow(
      "shop is read-only: statement 1 (SELECT) may change it.",
    );
    expect(run).not.toHaveBeenCalled();

    await executor.execute(conn({ tag: "production" }), sql);
    expect(confirm).toHaveBeenLastCalledWith("Run this statement on shop?", [
      "shop is tagged production.",
      sql,
    ]);

    confirm.mockClear();
    await executor.execute(conn({}), sql, { agent: true });
    expect(confirm).toHaveBeenLastCalledWith("Run this statement on shop?", [
      "An agent asks to change data.",
      sql,
    ]);

    // A person's run on an untagged connection asks nothing new: the confirmations stay as they are.
    confirm.mockClear();
    await executor.execute(conn({}), sql);
    expect(confirm).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(3);
  });
});
