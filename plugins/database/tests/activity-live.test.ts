// The activity view against a real PostgreSQL, through the plugin's commands on the desk core's
// sessions (core-bridge.ts). It runs when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database
// it may write in, for example postgresql://postgres:pw@db/scratch: a session that holds a row and
// sleeps blocks a second one on that row; the view lists both and draws who waits for whom; cancel
// stops the sleep and leaves the session; end ends it, and the second one goes on. A role of its own
// (dropped after) without pg_read_all_stats or pg_signal_backend is told what it cannot see, and why
// it may not cancel.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { DbPage } from "../../../packages/bridge/src/index";
import { normalize, parseUri } from "../ui/connections.js";
import { blockingTree, hiddenOf } from "../ui/features/activity/model.js";
import { serverSession } from "./core-bridge";
import { type Mounted, mount } from "./harness";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const TABLE = "endue_activity_live";
const ROLE = "t487_viewer";

type Seen = {
  pid: number;
  application: string | null;
  state: string | null;
  wait: string | null;
  statement: string | null;
};
type Summary = {
  sessions: Seen[];
  waits: { pid: number; waitsFor: number[]; lock: string }[];
  hidden: number;
};

/** One statement on the scratch database as the URI's role, for what the test sets up. */
const admin = async (sql: string) => {
  const own = await serverSession(uri, "activity admin");
  try {
    return await own.run(sql);
  } finally {
    await own.close();
  }
};

const opened: Array<Awaited<ReturnType<typeof serverSession>>> = [];
/**
 * A session of its own, named, running `sqls` one by one; `close` ends it after the last. `done`
 * settles with the last statement's error message, "" when every one went through.
 */
function session(name: string, sqls: string[], close = false) {
  let err = "";
  const done = (async () => {
    const own = await serverSession(uri, name);
    opened.push(own);
    for (const sql of sqls) {
      // A session the test's end terminates ends its statement with an error of its own.
      const page: DbPage | Error = await own.page(sql).catch((error: Error) => error);
      const failed = page instanceof Error ? page : page.error;
      if (failed) {
        err = failed.message;
        break;
      }
    }
    if (close) await own.close();
    return err;
  })();
  return { done, err: () => err };
}

/** Read again until `ok` holds, every 200 ms, for 15 s at most. */
async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`never held: ${JSON.stringify(value).slice(0, 2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** The plugin with one connection to the scratch database, as the URI's role or `as`. */
async function plugin(as?: { user: string; password: string }) {
  const { fields, password } = parseUri(uri);
  const conn = normalize({
    ...fields,
    ...(as ? { user: as.user } : {}),
    id: "c-live",
    name: "live",
  });
  const secret = as?.password ?? password;
  const procs = realProcs(secret ? { password: secret } : {});
  const handlers = procs.handlers;
  const m = await mount({ store: { connections: [conn] }, handlers, pick: () => "yes" });
  procs.attach((event) => m.host.emit(event));
  return m;
}
const activity = (m: Mounted) =>
  m.host.command("endue.database.activity", { connection: "live" }) as Promise<Summary>;
const named = (a: Summary, name: string) => a.sessions.find((s) => s.application === name);

afterAll(async () => {
  if (!uri) return;
  // A session left asleep in pg_sleep: end the tests' sessions by name, then let go of them.
  await admin(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${ROLE}' OR (application_name LIKE 'activity %' AND pid <> pg_backend_pid())`,
  );
  await Promise.all(opened.map((own) => own.close()));
  await admin(`DROP TABLE IF EXISTS ${TABLE}`);
  await admin(`DROP ROLE IF EXISTS ${ROLE}`);
});

describe.skipIf(!uri)("the server's activity on a real PostgreSQL", () => {
  it("lists a session in pg_sleep that blocks another on a row lock, shows the tree, cancels its statement and ends it", async () => {
    await admin(`DROP TABLE IF EXISTS ${TABLE}`);
    await admin(`CREATE TABLE ${TABLE} (id int PRIMARY KEY, v int)`);
    await admin(`INSERT INTO ${TABLE} VALUES (1, 0)`);
    const holder = session("activity holder", [
      "BEGIN",
      `UPDATE ${TABLE} SET v = v + 1 WHERE id = 1`,
      "SELECT pg_sleep(600)",
    ]);
    const m = await plugin();
    await until(
      () => activity(m),
      (a) => named(a, "activity holder")?.wait === "Timeout: PgSleep",
    );
    const waiter = session(
      "activity waiter",
      [`UPDATE ${TABLE} SET v = v + 10 WHERE id = 1`],
      true,
    );
    const seen = await until(
      () => activity(m),
      (a) => a.waits.some((w) => w.pid === named(a, "activity waiter")?.pid),
    );
    const holderPid = named(seen, "activity holder")?.pid as number;
    const waiterPid = named(seen, "activity waiter")?.pid as number;
    expect(named(seen, "activity holder")).toMatchObject({
      state: "active",
      wait: "Timeout: PgSleep",
    });
    expect(named(seen, "activity holder")?.statement).toContain("pg_sleep(600)");
    const wait = seen.waits.find((w) => w.pid === waiterPid);
    expect(wait?.waitsFor).toEqual([holderPid]);
    expect(wait?.lock).toMatch(/^ShareLock on transaction \d+$/u);
    const read = m.shown()?.activity.read;
    const tree = blockingTree(read.sessions, read.locks);
    expect(tree.find((n) => n.pid === holderPid)?.children.map((c) => c.pid)).toEqual([waiterPid]);

    // Cancel stops the sleep; the session stays in its failed transaction, which lets go of the
    // row, so the waiter's update goes through.
    await expect(
      m.host.command("endue.database.cancel-session", { connection: "live", pid: holderPid }),
    ).resolves.toEqual({ pid: holderPid, done: "cancelled" });
    // Asked first, the sleeping statement under Yes.
    expect(m.picks.at(-1)?.title).toBe(`Cancel the statement of session ${holderPid} on live?`);
    expect(m.picks.at(-1)?.items[0]).toMatchObject({
      id: "yes",
      detail: `Statement: ${named(seen, "activity holder")?.statement}`,
    });
    await until(
      () => activity(m),
      (a) => named(a, "activity holder")?.state === "idle in transaction (aborted)",
    );
    expect(holder.err()).toMatch(/canceling statement due to user request/u);
    expect(await waiter.done).toBe("");
    const freed = await until(
      () => activity(m),
      (a) => !a.waits.some((w) => w.pid === waiterPid),
    );
    expect(named(freed, "activity holder")?.state).toBe("idle in transaction (aborted)");

    // End ends it: its connection closes, its transaction rolls back (the waiter's update stays).
    await expect(
      m.host.command("endue.database.end-session", { connection: "live", pid: holderPid }),
    ).resolves.toEqual({ pid: holderPid, done: "ended" });
    await until(
      () => activity(m),
      (a) => !a.sessions.some((s) => s.pid === holderPid),
    );
    expect(await admin(`SELECT v FROM ${TABLE} WHERE id = 1`)).toBe("10");
  }, 60_000);

  it("says the server's refusal and what is hidden for a role without the privileges", async () => {
    const password = randomUUID();
    await admin(`DROP ROLE IF EXISTS ${ROLE}`);
    await admin(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}'`);
    session("activity sleeper", ["SELECT pg_sleep(600)"]);
    const m = await plugin({ user: ROLE, password });
    const seen = await until(
      () => activity(m),
      (a) => named(a, "activity sleeper") !== undefined,
    );
    expect(named(seen, "activity sleeper")).toMatchObject({
      statement: null,
      state: null,
      wait: null,
    });
    expect(seen.hidden).toBeGreaterThanOrEqual(1);
    expect(hiddenOf(m.shown()?.activity.read.sessions)).toMatch(/pg_read_all_stats/u);
    const pid = named(seen, "activity sleeper")?.pid;
    await expect(
      m.host.command("endue.database.cancel-session", { connection: "live", pid }),
    ).rejects.toThrow(/Not cancelled: permission denied to cancel query/u);
    expect(m.view.said.at(-1)).toMatch(/^Not cancelled: permission denied to cancel query/u);
  }, 60_000);
});
