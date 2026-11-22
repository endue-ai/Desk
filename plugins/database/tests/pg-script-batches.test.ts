// A long PostgreSQL script runs in batches on its session (PG-01d, ADR 0344): consecutive
// statements go to the core in db.script calls of at most BATCH statements, not one db.run each,
// and each statement still has its own outcome: its rows, its notices, its error with its position,
// the first error stopping the run with what ran before it said, a result with rows past its page
// read on before the rest of the batch, and Cancel stopping the batch where it is.
import { describe, expect, it } from "vitest";
import type { DbColumn, StubDatabase } from "../../../packages/bridge/src/index";
import type { Connection } from "../ui/engines/common.js";
import { BATCH } from "../ui/engines/pg-script.js";
import { sessionExecutor } from "./pg-host";

const PG = {
  id: "c-pg",
  name: "Shop",
  engine: "postgresql",
  host: "db.example",
  port: 5432,
  database: "shop",
  user: "app",
  ssl: "default",
  sslCa: "",
  file: "",
  tag: "none",
  readOnly: false,
} as Connection;
const col = (name: string): DbColumn => ({
  name,
  typeOid: 23,
  typeModifier: -1,
  typeSize: 4,
  tableOid: 0,
  columnNumber: 0,
});
const note = (message: string) => ({
  severity: "NOTICE",
  localSeverity: "NOTICE",
  code: "00000",
  message,
});
const grant = [{ permission: "db:connect" as const, hosts: ["*"] }];
const inserts = (n: number) => Array.from({ length: n }, (_, i) => `insert into t values (${i})`);
const db: StubDatabase = {
  statements: [
    { sql: /^insert into t values \(\d+\)$/, tag: "INSERT 0 1" },
    { sql: "select n", columns: [col("n")], rows: Array.from({ length: 30 }, (_, i) => [`${i}`]) },
    { sql: "do $$ say $$", tag: "DO", notices: [note("said")] },
    {
      sql: "select\n  nope",
      error: { ...note('column "nope" does not exist'), code: "42703", position: 10 },
    },
    { sql: "select pg_sleep(9)", waits: true },
  ],
};

describe("a long PostgreSQL script runs in batches", () => {
  it("sends the statements in db.script batches, each statement with its own outcome", async () => {
    const t = sessionExecutor(db, { grants: grant });
    const count = BATCH * 2 + 7;
    const run = await t.execute(PG, inserts(count).join(";\n"));
    const outcomes = run.result.statements;
    expect(outcomes).toHaveLength(count);
    expect(outcomes.every((o) => o.ran && !o.error && o.affected === 1)).toBe(true);
    expect(t.made("db.run")).toHaveLength(0);
    const batches = t.made("db.script") as { statements: { sql: string }[] }[];
    expect(batches.map((b) => b.statements.length)).toEqual([BATCH, BATCH, 7]);
    expect(batches.flatMap((b) => b.statements.map((s) => s.sql))).toEqual(inserts(count));
  });

  it("a statement's notices and rows stay its own, and rows past the page are read before the rest", async () => {
    const t = sessionExecutor(db, { grants: grant, settings: { "endue.database.max-rows": 20 } });
    const sql = ["insert into t values (1)", "do $$ say $$", "select n", "insert into t values (2)"];
    const run = await t.execute(PG, sql.join(";\n"));
    const [first, said, rows, last] = run.result.statements;
    expect(first?.notices).toEqual([]);
    expect(said?.notices).toEqual(["NOTICE:  said"]);
    expect(rows?.sets[0]?.rows).toHaveLength(20);
    expect(rows?.sets[0]?.truncated).toBe(true);
    expect(last?.affected).toBe(1);
    // The batch stopped at the result with pages left; it was closed, then the rest ran.
    const calls = t.calls.map((c) => c.method).filter((m) => m !== "db.open" && m !== "db.close");
    expect(calls).toEqual(["db.script", "db.fetch", "db.script"]);
  });

  it("the first error stops the run there, with its position, and says what ran before it", async () => {
    const t = sessionExecutor(db, { grants: grant });
    const sql = [...inserts(3), "select\n  nope", ...inserts(BATCH)];
    const text = sql.join(";\n");
    const run = await t.execute(PG, text);
    const outcomes = run.result.statements;
    expect(outcomes.slice(0, 3).every((o) => o.ran && !o.error)).toBe(true);
    expect(outcomes[3]?.error).toMatchObject({ kind: "sql", code: "42703", position: 9 });
    expect(outcomes.slice(4).every((o) => !o.ran)).toBe(true);
    expect(t.made("db.script")).toHaveLength(1);
  });

  it("Cancel stops the batch at the statement that runs; nothing after it runs", async () => {
    const t = sessionExecutor(db, { grants: grant });
    const sql = [...inserts(2), "select pg_sleep(9)", ...inserts(5)];
    const running = t.execute(PG, sql.join(";\n"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    t.sessions.cancel();
    const run = await running;
    const states = run.result.statements.map((o) => [o.ran, o.error?.kind]);
    expect(states).toEqual([
      [true, undefined],
      [true, undefined],
      [true, "cancelled"],
      ...Array.from({ length: 5 }, () => [false, undefined]),
    ]);
    expect(t.made("db.cancel")).toHaveLength(1);
  });

  it("a run in a transaction wraps the batches in BEGIN and COMMIT of its own", async () => {
    const t = sessionExecutor(db, { grants: grant });
    await t.execute(PG, inserts(3).join(";\n"), { mode: "transaction" });
    const order = t.calls
      .filter((c) => c.method === "db.run" || c.method === "db.script")
      .map((c) => (c.method === "db.run" ? c.params.sql : `script of ${(c.params.statements as unknown[]).length}`));
    expect(order).toEqual(["BEGIN", "script of 3", "COMMIT"]);
  });
});
