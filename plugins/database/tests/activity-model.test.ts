// The server's activity as the view reads it (ui/features/activity/): the sessions and locks from
// the rows PostgreSQL answers, the filters and the sort, who waits for whom as a tree, what a role
// cannot see, and the SQL that differs by server version.
import { describe, expect, it } from "vitest";
import { settingsOf } from "../ui/engines/pg-session.js";
import {
  blockingTree,
  DEFAULT_VIEW,
  durationOf,
  hiddenOf,
  lockText,
  readOf,
  type Session,
  sorted,
  summaryOf,
  visible,
} from "../ui/features/activity/model.js";
import {
  locksSql,
  OWN_APPLICATION,
  sessionsSql,
  signalSql,
  tooOld,
} from "../ui/features/activity/sql.js";
import { activityRows } from "./activity-fixture";

const read = (version = 170006) => {
  const rows = activityRows(version);
  return readOf(rows.head, rows.sessions, rows.locks, false, 1_700_000_000_000);
};
const pids = (sessions: Session[]) => sessions.map((s) => s.pid);
const session = (pid: number, blockedBy: number[], queryMs: number | null = null): Session => ({
  ...(read().sessions.find((s) => s.pid === 4242) as Session),
  pid,
  blockedBy,
  queryMs,
});

describe("reading the activity", () => {
  it("reads sessions and locks from the server's rows", () => {
    const { version, server, own, sessions, locks } = read();
    expect({ version, server, own }).toEqual({ version: 170006, server: "17.6", own: 4250 });
    expect(sessions.find((s) => s.pid === 4243)).toEqual({
      pid: 4243,
      leader: null,
      user: "bob",
      database: "warehouse",
      application: "reports",
      client: "10.0.0.7",
      backend: "client backend",
      state: "active",
      waitType: "Lock",
      wait: "transactionid",
      stateMs: 30000,
      xactMs: 30000,
      queryMs: 30000,
      blockedBy: [4242],
      query: "UPDATE orders SET total = total + 1 WHERE id = 1",
      hidden: false,
      own: "",
    });
    // NULL is no age, never 0; 0 stays 0. The view's own session and the plugin's are marked.
    const byPid = (pid: number) => sessions.find((s) => s.pid === pid);
    expect(byPid(4251)?.xactMs).toBeNull();
    expect(byPid(4250)).toMatchObject({ own: "view", stateMs: 0, client: "local" });
    expect(byPid(4251)?.own).toBe("plugin");
    expect(byPid(4260)).toMatchObject({ hidden: true, query: null, state: null, client: null });
    expect(locks.map((l) => [l.pid, lockText(l), l.granted, l.waitMs])).toEqual([
      [4243, "ShareLock on transaction 731", false, 30000],
      [4244, "ExclusiveLock on orders (page 0, tuple 1)", false, 12000],
      [4242, "ExclusiveLock on transaction 731", true, null],
      [4243, "ExclusiveLock on orders (page 0, tuple 1)", true, null],
      [4242, "RowExclusiveLock on orders", true, null],
      [4243, "RowExclusiveLock on orders", true, null],
      [4244, "RowExclusiveLock on orders", true, null],
      [4250, "ExclusiveLock on virtual transaction 5/12", true, null],
      [4300, "RowExclusiveLock on stock", true, null],
    ]);
    // A real psql prints NULL as null; a NULL age is no age there too.
    const real = readOf(
      ["170006", "17.6", "1", "w"],
      [
        [
          "7",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ],
      ],
      [],
      false,
      0,
    );
    expect(real.sessions[0]).toMatchObject({ pid: 7, stateMs: null, blockedBy: [], query: null });
    expect(OWN_APPLICATION).toBe(settingsOf(0).application_name);
  });

  it("filters idle, background processes, the view's own session and by database, and sorts either way", () => {
    const { sessions } = read();
    expect(DEFAULT_VIEW).toEqual({
      filters: { idle: true, own: true, system: false, database: "" },
      sort: { key: "xactMs", desc: true },
    });
    expect(pids(visible(sessions, DEFAULT_VIEW.filters))).toEqual([4242, 4243, 4244, 4260, 4300]);
    const all = { idle: false, own: false, system: true, database: "" };
    expect(visible(sessions, all)).toHaveLength(8);
    expect(pids(visible(sessions, { ...all, database: "archive" }))).toEqual([4260]);
    const shown = visible(sessions, DEFAULT_VIEW.filters);
    expect(pids(sorted(shown, DEFAULT_VIEW.sort))).toEqual([4300, 4242, 4243, 4244, 4260]);
    expect(pids(sorted(shown, { key: "xactMs", desc: false }))).toEqual([
      4244, 4243, 4242, 4300, 4260,
    ]);
    expect(pids(sorted(shown, { key: "user", desc: false }))).toEqual([
      4242, 4300, 4243, 4244, 4260,
    ]);
    expect(pids(sorted(shown, { key: "pid", desc: true }))).toEqual([4300, 4260, 4244, 4243, 4242]);
  });

  it("builds who waits for whom as a tree, on which lock, the longest wait first", () => {
    const { sessions, locks } = read();
    const [root, ...others] = blockingTree(sessions, locks);
    expect(others).toEqual([]);
    expect(root).toMatchObject({ pid: 4242, waitMs: null, longest: 30000, lock: undefined });
    const waiter = root?.children[0];
    expect(waiter?.pid).toBe(4243);
    expect(waiter?.lock && lockText(waiter.lock)).toBe("ShareLock on transaction 731");
    expect(waiter?.held && lockText(waiter.held)).toBe("ExclusiveLock on transaction 731");
    expect(waiter?.waitMs).toBe(30000);
    const next = waiter?.children[0];
    expect(next?.pid).toBe(4244);
    expect(next?.lock && lockText(next.lock)).toBe("ExclusiveLock on orders (page 0, tuple 1)");
    expect(next?.held?.pid).toBe(4243);
    // A waiter is under each of its blockers; a cycle is drawn once; the longest wait comes first
    // (without a wait start, the waiting statement's age is its wait).
    const two = blockingTree(
      [session(1, []), session(2, []), session(3, [1, 2], 9000), session(4, [1], 2000)],
      [],
    );
    expect(two.map((n) => [n.pid, n.children.map((c) => c.pid)])).toEqual([
      [1, [3, 4]],
      [2, [3]],
    ]);
    const cycle = blockingTree([session(5, [6], 1000), session(6, [5], 4000)], []);
    expect(cycle.map((n) => n.pid)).toEqual([5]);
    expect(cycle[0]?.children[0]).toMatchObject({ pid: 6, waitMs: 4000 });
    expect(cycle[0]?.children[0]?.children[0]).toMatchObject({ pid: 5, again: true, children: [] });
    const longer = blockingTree(
      [session(7, []), session(8, [7], 5000), session(9, []), session(10, [9], 9000)],
      [],
    );
    expect(longer.map((n) => n.pid)).toEqual([9, 7]);
  });

  it("says what a role without pg_read_all_stats cannot see", () => {
    const { sessions } = read();
    expect(hiddenOf(sessions)).toBe(
      "1 session of another role hides its statement, state and waits: the pg_read_all_stats role (or a superuser) shows them.",
    );
    const two = [...sessions, { ...(sessions.find((s) => s.hidden) as Session), pid: 4261 }];
    expect(hiddenOf(two)).toMatch(
      /^2 sessions of other roles hide their statements, states and waits/u,
    );
    expect(hiddenOf(sessions.filter((s) => !s.hidden))).toBe("");
  });

  it("reads the wait start from PostgreSQL 14 on and the query's age on 13, ends with a wait from 14 on, and refuses servers older than 13", () => {
    expect(locksSql(140000)).toContain("l.waitstart");
    expect(locksSql(130008)).not.toContain("waitstart");
    expect(sessionsSql()).toContain("pg_catalog.pg_blocking_pids(a.pid)");
    expect(signalSql("cancel", 4242, 170006)).toBe("SELECT pg_catalog.pg_cancel_backend(4242)");
    expect(signalSql("end", 4242, 140000)).toBe(
      "SELECT pg_catalog.pg_terminate_backend(4242, 5000)",
    );
    expect(signalSql("end", 4242, 130008)).toBe("SELECT pg_catalog.pg_terminate_backend(4242)");
    expect(() => signalSql("end", Number.NaN, 170006)).toThrow(/process id/u);
    expect(() => signalSql("cancel", 1.5, 170006)).toThrow(/process id/u);
    expect(tooOld("old", 120017, "12.17")).toBe(
      "old runs PostgreSQL 12.17: the activity view reads PostgreSQL 13 and later.",
    );
    expect(tooOld("new", 130000, "13.0")).toBe("");
    // On 13 no lock says when its wait began: the waiting statement's age stands for it.
    const thirteen = read(130008);
    const rows = activityRows(130008);
    const noStart = readOf(
      rows.head,
      rows.sessions,
      rows.locks.map((l) => [...l.slice(0, 11), ""]),
      false,
      0,
    );
    expect(thirteen.version).toBe(130008);
    expect(blockingTree(noStart.sessions, noStart.locks)[0]?.children[0]?.waitMs).toBe(30000);
  });
});

describe("what agents and the status line read", () => {
  it("answers the sessions an agent asks for and who waits for whom, in seconds", () => {
    const summary = summaryOf(read());
    expect(summary.server).toBe("17.6");
    expect(summary.hidden).toBe(1);
    expect(summary.sessions.map((s) => s.pid)).toEqual([4300, 4242, 4243, 4244, 4260]);
    expect(summary.sessions[1]).toEqual({
      pid: 4242,
      user: "alice",
      database: "warehouse",
      application: "billing",
      client: "10.0.0.5",
      state: "active",
      wait: "Timeout: PgSleep",
      transactionSeconds: 95,
      statementSeconds: 60,
      blockedBy: [],
      statement: "SELECT pg_sleep(600)",
    });
    expect(summary.waits).toEqual([
      { pid: 4243, waitsFor: [4242], lock: "ShareLock on transaction 731", waitSeconds: 30 },
      {
        pid: 4244,
        waitsFor: [4243],
        lock: "ExclusiveLock on orders (page 0, tuple 1)",
        waitSeconds: 12,
      },
    ]);
    expect([850, 12_000, 95_000, 7_500_000, 90_000_000, null].map(durationOf)).toEqual([
      "850 ms",
      "12 s",
      "1 min 35 s",
      "2 h 5 min",
      "1 d 1 h",
      "",
    ]);
  });
});
