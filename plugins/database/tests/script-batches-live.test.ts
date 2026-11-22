// A long PostgreSQL script in batches against a real server (PG-01d, ADR 0344): the plugin's
// executor on the desk core's sessions (core-bridge.ts) sends a script in db.script batches, and
// each statement keeps its outcome: everything ran once, the first error stops the run at its
// statement with its position, a statement's notices are its own, and Cancel stops a batch where it
// is. It runs when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database, as live.test.ts does.
import { describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { BATCH } from "../ui/engines/pg-script.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { fromValues } from "../ui/settings.js";
import { sharedCore } from "./core-bridge";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const conn = (uri ? normalize({ ...fields, id: "c-live", name: "live" }) : {}) as Connection;

/** The plugin's executor on the shared core, counting the calls it makes by method. */
function onCore() {
  const core = sharedCore();
  const made = new Map<string, number>();
  const call = (method: string, params: unknown) => {
    made.set(method, (made.get(method) ?? 0) + 1);
    return core.call(method, params);
  };
  const sessions = createSessions({ call, onEvent: core.onEvent } as never);
  const executor = createExecutor({
    runner: { run: async () => Promise.reject(new Error("no client runs for PostgreSQL")) },
    output: { read: async () => Promise.reject(new Error("nothing to read")) },
    clients: { get: async () => Promise.reject(new Error("no client")) },
    sessions,
    settings: () => fromValues({}),
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message: string) => new Error(message),
  } as never);
  return { sessions, made, run: (sql: string) => executor.execute(conn, sql) };
}

const one = async (sql: string) => {
  const done = await onCore().run(sql);
  const first = done.result.statements[0];
  if (first?.error) throw new Error(first.error.message);
  return first?.sets[0]?.rows[0]?.[0];
};
const inserts = (table: string, from: number, n: number) =>
  Array.from({ length: n }, (_, i) => `insert into ${table} values (${from + i})`);

describe.skipIf(!uri)("a long PostgreSQL script in batches, on a real server", () => {
  it("2,000 INSERTs run once each, in batches", { timeout: 120_000 }, async () => {
    await one("drop table if exists t540_many; create table t540_many (id int primary key)");
    const { run, made } = onCore();
    const done = await run(inserts("t540_many", 1, 2000).join(";\n"));
    expect(done.result.statements.every((s) => s.ran && !s.error && s.affected === 1)).toBe(true);
    expect(made.get("db.script")).toBe(Math.ceil(2000 / BATCH));
    expect(made.get("db.run") ?? 0).toBe(0);
    expect(await one("select count(*) from t540_many")).toBe("2000");
  });

  it("the first error stops the run there with its position; what ran before stays", async () => {
    await one("drop table if exists t540_err; create table t540_err (id int primary key)");
    const { run } = onCore();
    const bad = "select 1,\n  nope";
    const sql = [...inserts("t540_err", 1, 5), bad, ...inserts("t540_err", 6, 5)];
    const done = await run(sql.join(";\n"));
    const outcomes = done.result.statements;
    expect(outcomes.slice(0, 5).every((o) => o.ran && !o.error)).toBe(true);
    expect(outcomes[5]?.error).toMatchObject({
      kind: "sql",
      code: "42703",
      position: bad.indexOf("nope"),
    });
    expect(outcomes.slice(6).every((o) => !o.ran)).toBe(true);
    expect(await one("select count(*) from t540_err")).toBe("5");
  });

  it("each statement's notices are its own", async () => {
    const { run } = onCore();
    const say = (word: string) => `do $$ begin raise notice '${word}'; end $$`;
    const done = await run(["select 1", say("two"), "select 3", say("four")].join(";\n"));
    expect(
      done.result.statements.map((s) => s.notices.filter((n) => n.startsWith("NOTICE"))),
    ).toEqual([[], ["NOTICE:  two"], [], ["NOTICE:  four"]]);
  });

  it("Cancel stops a batch where it is", { timeout: 30_000 }, async () => {
    const { run, sessions } = onCore();
    const started = Date.now();
    const running = run(Array.from({ length: 150 }, () => "select pg_sleep(0.05)").join(";\n"));
    await new Promise((resolve) => setTimeout(resolve, 600));
    sessions.cancel();
    const done = await running;
    const ran = done.result.statements.filter((s) => s.ran).length;
    expect(ran).toBeGreaterThan(0);
    expect(ran).toBeLessThan(150);
    expect(done.result.statements.slice(ran).every((s) => !s.ran)).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
