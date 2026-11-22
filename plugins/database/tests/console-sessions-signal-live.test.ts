// A run's own signal on the sessions consoles keep, on a real server (PG-02 with PG-81's signal,
// ADR 0320), through the desk core's sessions (core-bridge.ts): aborting one console's pg_sleep
// cancels that statement on the server, and the console's session stays the same backend with its
// SET; another console's open transaction goes on untouched, and a cancel inside it leaves it failed
// until ROLLBACK. It runs when ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database (live.test.ts).
import { afterAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor, type ExecuteOptions } from "../ui/execute.js";
import { fromValues } from "../ui/settings.js";
import { liveSessions } from "./live-sessions";
import { nodeBridge } from "./node-bridge";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const server = liveSessions(uri, "endue console-signal");
const LIVE = (uri ? normalize({ ...fields, id: "c-live-signal", name: "live" }) : {}) as Connection;

/** The plugin's executor on the core's sessions; made in the test, so a run without a URI starts no core. */
function live() {
  const sessions = createSessions(nodeBridge() as never);
  const settings = fromValues({});
  const executor = createExecutor({
    runner: { run: async () => Promise.reject(new Error("no client runs for PostgreSQL")) },
    output: { read: async () => Promise.reject(new Error("nothing to read")) },
    clients: { get: async () => Promise.reject(new Error("no client")) },
    sessions,
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message: string) => new Error(message),
  } as never);
  const on = (owner: string, sql: string, more: ExecuteOptions = {}) =>
    executor.execute(LIVE, sql, { session: { owner, kind: "console" }, ...more });
  const value = async (owner: string, sql: string) =>
    (await on(owner, sql)).result.statements[0]?.sets[0]?.rows[0]?.[0];
  /** Run pg_sleep on `owner`'s session and abort it once the server shows it running. */
  const sleepThenAbort = async (owner: string, pid: unknown) => {
    const stop = new AbortController();
    const started = Date.now();
    const ran = on(owner, "select pg_sleep(30)", { signal: stop.signal });
    const running = `select count(*) from pg_stat_activity where pid = ${Number(pid)} and state = 'active' and query like '%pg_sleep%'`;
    while ((await server.admin(running)) !== "1") {
      if (Date.now() - started > 10_000) throw new Error("pg_sleep never started");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    stop.abort();
    const done = await ran;
    return { error: done.result.statements[0]?.error, ms: Date.now() - started };
  };
  return { sessions, on, value, sleepThenAbort };
}

describe.skipIf(!uri)("a run's own signal on a console's session, on a real server", () => {
  let made: ReturnType<typeof live> | undefined;
  afterAll(async () => {
    await made?.sessions.close(() => true);
    await server.end();
  });

  it("cancels one console's statement; its session keeps its backend and SET, the other its transaction", async () => {
    made = live();
    const { sessions, on, value, sleepThenAbort } = made;
    await on("console:a", "set work_mem = '7MB'");
    const a = await value("console:a", "select pg_backend_pid()");
    await on("console:b", "begin;\ncreate temporary table signal_seen as select 7 as v");
    const b = await value("console:b", "select pg_backend_pid()");
    expect(sessions.state("console:b").state).toBe("open");

    const cut = await sleepThenAbort("console:a", a);
    expect(cut.error?.kind).toBe("cancelled");
    expect(cut.ms).toBeLessThan(15_000);
    expect(sessions.state("console:a").state).toBe("idle");
    expect(await value("console:a", "select pg_backend_pid()")).toBe(a);
    expect(await value("console:a", "show work_mem")).toBe("7MB");

    // b's transaction went on: still open, on its own backend, its table there.
    expect(sessions.state("console:b").state).toBe("open");
    expect(await value("console:b", "select v from signal_seen")).toBe("7");
    expect(await value("console:b", "select pg_backend_pid()")).toBe(b);

    // A cancel inside b's transaction leaves it failed, on the same backend, until ROLLBACK.
    const inside = await sleepThenAbort("console:b", b);
    expect(inside.error?.kind).toBe("cancelled");
    expect(sessions.state("console:b").state).toBe("failed");
    await on("console:b", "rollback");
    expect(sessions.state("console:b").state).toBe("idle");
    expect(await value("console:b", "select pg_backend_pid()")).toBe(b);
  });
});
