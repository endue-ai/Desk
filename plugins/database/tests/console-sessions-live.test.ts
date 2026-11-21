// A console's PostgreSQL session on a real server (PG-02, ADR 0320), through the desk core's sessions
// (core-bridge.ts): a transaction spans runs and another session does not see it; a SET and a
// temporary table survive runs; a session ended with pg_terminate_backend is reported and the next
// run opens a new one; and a console's open transaction does not block a table view of another
// table. It runs when ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database (live.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { type Mounted, mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";
import { run, state } from "./session-helpers";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const server = liveSessions(uri, "endue console-sessions");
const LIVE = { ...normalize({ ...fields, id: "c-live-sessions", name: "live" }) } as Connection;

/** The plugin on the real core with the live connection's console on screen. */
async function live(): Promise<Mounted> {
  const procs = realProcs(password ? { password } : {});
  const m = await mount({ store: { connections: [LIVE] }, handlers: procs.handlers });
  procs.attach((event) => m.host.emit(event));
  await m.host.command("endue.database.console", { connection: "live" });
  return m;
}

/** The first value of the result on screen. */
const first = (m: Mounted) =>
  m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows[0]?.[0];

const until = async (test: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/** Close the console's sessions: Disconnect. */
const done = (m: Mounted) => m.host.command("endue.database.disconnect", { connection: "live" });

describe.skipIf(!uri)("a console's session on a real server", () => {
  beforeAll(async () => {
    await server.end();
    await server.admin("DROP TABLE IF EXISTS console_sessions_a, console_sessions_b");
    await server.admin("CREATE TABLE console_sessions_a (id int)");
    await server.admin("CREATE TABLE console_sessions_b AS SELECT 7 AS id");
  });
  afterAll(async () => {
    await server.end();
    await server.admin("DROP TABLE IF EXISTS console_sessions_a, console_sessions_b");
  });

  it("BEGIN and INSERT in one run, a SELECT in the next sees it, ROLLBACK in a third", async () => {
    const m = await live();
    await run(m, "begin;\ninsert into console_sessions_a values (1)");
    expect(state(m)).toBe("open");
    await run(m, "select count(*) from console_sessions_a");
    expect(first(m)).toBe("1");
    expect(await server.admin("select count(*) from console_sessions_a")).toBe("0");
    await run(m, "rollback");
    expect(state(m)).toBe("idle");
    await run(m, "select count(*) from console_sessions_a");
    expect(first(m)).toBe("0");
    await done(m);
  });

  it("a SET and a temporary table survive runs", async () => {
    const m = await live();
    await run(m, "set work_mem = '7MB'");
    await run(m, "create temporary table console_seen as select 42 as v");
    await run(m, "show work_mem");
    expect(first(m)).toBe("7MB");
    await run(m, "select v from console_seen");
    expect(first(m)).toBe("42");
    await done(m);
  });

  it("pg_terminate_backend of the console's session is reported, and the next run works on a new one", async () => {
    const m = await live();
    await run(m, "set work_mem = '7MB'");
    await run(m, "begin");
    const pid = m.shown()?.session?.pid;
    expect(pid).toBeGreaterThan(0);
    await server.admin(`select pg_terminate_backend(${pid})`);
    await until(() => state(m) === "lost");
    expect(m.shown()?.session?.detail).toMatch(/terminating connection.*rolled back/su);
    await run(m, "show work_mem");
    expect(first(m)).not.toBe("7MB");
    expect(state(m)).toBe("idle");
    expect(m.shown()?.session?.pid).not.toBe(pid);
    await done(m);
  });

  it("a console's open transaction does not block a table view of another table", async () => {
    const m = await live();
    await run(m, "begin;\nlock table console_sessions_a in access exclusive mode");
    expect(state(m)).toBe("open");
    const held = m.shown()?.session?.pid;
    const shown = m.host.command("endue.database.open-table", {
      connection: "live",
      schema: "public",
      table: "console_sessions_b",
    });
    await Promise.race([
      shown,
      new Promise((_, reject) => setTimeout(() => reject(new Error("blocked")), 10_000)),
    ]);
    await m.settle();
    expect(first(m)).toBe("7");
    expect(m.shown()?.session?.pid).not.toBe(held);
    await m.host.command("endue.database.consoles", { console: "live" });
    await run(m, "rollback");
    expect(state(m)).toBe("idle");
    await done(m);
  });
});
