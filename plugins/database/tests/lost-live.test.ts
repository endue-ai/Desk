// A lost connection on a real server (PG-105, ADR 0355), through the desk core's sessions
// (core-bridge.ts): pg_terminate_backend from another session of this database ends a console's
// session idle (it comes back on its own), mid-statement (the run says so), inside a manual
// transaction (rolled back, its statements said, nothing replayed) and during a Submit of pending
// edits, before COMMIT (still pending, then Submit works) and during it (unknown, how to check);
// the next run works each time. It runs when ENDUE_DB_TEST_POSTGRES holds a URI of a scratch
// database (live.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { createEdits } from "../ui/edits.js";
import type { Connection } from "../ui/engines/common.js";
import { editHarness } from "./edit-joins-harness";
import { type Mounted, mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";
import { messages, run, start, state } from "./session-helpers";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const server = liveSessions(uri, "endue lost");
const LIVE = (uri ? normalize({ ...fields, id: "c-live-lost", name: "live" }) : {}) as Connection;
const TABLE = "t500_lost";
// The plugin holds the server's grant, as perm.query tells it.
const granted = { "perm.query": () => ({ grants: [{ permission: "db:connect" }] }) as never };

async function live(): Promise<Mounted> {
  const procs = realProcs(password ? { password } : {});
  const m = await mount({
    store: { connections: [LIVE] },
    handlers: { ...procs.handlers, ...granted },
  });
  procs.attach((event) => m.host.emit(event));
  await m.host.command("endue.database.console", { connection: "live" });
  return m;
}

const first = (m: Mounted) =>
  m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows[0]?.[0];
const until = async (test: () => boolean | Promise<boolean>, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const terminate = (pid: number | undefined) =>
  server.admin(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid = ${Number(pid)}`,
  );
/** The pid of this database's session whose statement matches `like`, once one runs it. */
const runningPid = async (like: string) => {
  let pid = "";
  await until(async () => {
    pid = await server.admin(
      `select coalesce(max(pid), 0) from pg_stat_activity where datname = current_database() and state = 'active' and query like '${like}'`,
    );
    return pid !== "0";
  });
  return Number(pid);
};
const done = (m: Mounted) => m.host.command("endue.database.disconnect", { connection: "live" });

describe.skipIf(!uri)("a lost connection on a real server", () => {
  /** Each statement as the URI's role, one after another. */
  const admins = async (...sqls: string[]) => {
    for (const sql of sqls) await server.admin(sql);
  };
  const drop = () =>
    admins(
      `DROP TABLE IF EXISTS ${TABLE}, t500_slow, t500_edit`,
      "DROP FUNCTION IF EXISTS t500_sleep()",
    );

  beforeAll(async () => {
    await server.end();
    await drop();
    await admins(
      `CREATE TABLE ${TABLE} (id int)`,
      "CREATE TABLE t500_slow (on_update boolean, on_commit boolean)",
      "CREATE TABLE t500_edit (id int primary key, name text)",
      "INSERT INTO t500_edit VALUES (1, 'ann'), (2, 'bob')",
      "CREATE FUNCTION t500_sleep() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN " +
        "IF EXISTS (SELECT 1 FROM t500_slow WHERE on_update AND TG_WHEN = 'BEFORE') OR " +
        "EXISTS (SELECT 1 FROM t500_slow WHERE on_commit AND TG_WHEN = 'AFTER') THEN PERFORM pg_sleep(20); END IF; " +
        "RETURN NEW; END $$",
      "CREATE TRIGGER t500_before BEFORE UPDATE ON t500_edit FOR EACH ROW EXECUTE FUNCTION t500_sleep()",
      "CREATE CONSTRAINT TRIGGER t500_commit AFTER UPDATE ON t500_edit DEFERRABLE INITIALLY DEFERRED " +
        "FOR EACH ROW EXECUTE FUNCTION t500_sleep()",
    );
  });
  afterAll(async () => {
    await server.end("application_name = 'endue Desk'");
    await drop();
  });

  it("an idle console's session comes back on its own, and the next run works", async () => {
    const m = await live();
    await run(m, "select 1");
    const pid = m.shown()?.session?.pid;
    await terminate(pid);
    await until(() => state(m) === "lost");
    expect(m.shown()?.session?.detail).toMatch(
      /terminating connection.*Connecting again on its own/su,
    );
    await until(() => state(m) === "idle");
    expect(m.shown()?.session?.pid).not.toBe(pid);
    expect(m.view.said.join("\n")).toMatch(/connected again on a new session/u);
    await run(m, "select 2");
    expect(first(m)).toBe("2");
    await done(m);
  });

  it("a statement ended mid-run says the session ended, and the next run works", async () => {
    const m = await live();
    await run(m, "select 1");
    const going = await start(m, "select pg_sleep(20)");
    await terminate(await runningPid("select pg_sleep(20)"));
    await going.done;
    await m.settle();
    expect(messages(m).join("\n")).toMatch(/terminating connection/u);
    await run(m, "select 3");
    expect(first(m)).toBe("3");
    expect(state(m)).toBe("idle");
    await done(m);
  });

  it("a manual transaction lost with its session is said with its statements and never replayed", async () => {
    await server.admin(`TRUNCATE ${TABLE}`);
    const m = await live();
    await m.host.command("endue.database.transaction-mode", { mode: "manual" });
    await run(m, `insert into ${TABLE} values (1)`);
    await run(m, `insert into ${TABLE} values (2)`);
    expect(state(m)).toBe("open");
    await terminate(m.shown()?.session?.pid);
    await until(() => state(m) === "lost");
    expect(m.view.said.join("\n")).toMatch(
      /rolled back its open transaction with its 2 statements; none was run again/u,
    );
    expect(m.shown()?.session?.detail).toMatch(
      /insert into t500_lost values \(1\).*insert into t500_lost values \(2\)/su,
    );
    // Not tried on its own: a transaction was lost.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(state(m)).toBe("lost");
    await run(m, `select count(*) from ${TABLE}`);
    expect(first(m)).toBe("0");
    expect(messages(m).join("\n")).toMatch(/held 2 statements/u);
    expect(await server.admin(`select count(*) from ${TABLE}`)).toBe("0");
    await m.host.command("endue.database.rollback");
    await done(m);
  });

  it("a Submit ended before COMMIT keeps the edits pending, and Submit works after", async () => {
    const h = editHarness(uri);
    const e = createEdits({
      catalog: h.catalog,
      execute: h.execute,
      render: () => {},
      reload: h.reload,
    });
    await admins("TRUNCATE t500_slow", "INSERT INTO t500_slow VALUES (true, false)");
    const shown = await h.show("select id, name from t500_edit order by id");
    await e.editCell(shown, h.conn, 0, 1, "ann b");
    const submitted = e.submit(shown, h.conn).catch((error: Error) => error.message);
    await terminate(await runningPid("UPDATE %t500_edit%"));
    expect(await submitted).toMatch(/^Not committed: the session ended.*still pending/su);
    expect(e.pending(shown)).toBe(true);
    await server.admin("TRUNCATE t500_slow");
    expect(await e.submit(shown, h.conn)).toBe("Committed 1 change in one transaction.");
    expect(await server.admin("select name from t500_edit where id = 1")).toBe("ann b");
  });

  it("a Submit ended during COMMIT says it is unknown and how to check", async () => {
    const h = editHarness(uri);
    const e = createEdits({
      catalog: h.catalog,
      execute: h.execute,
      render: () => {},
      reload: h.reload,
    });
    await admins("TRUNCATE t500_slow", "INSERT INTO t500_slow VALUES (false, true)");
    const shown = await h.show("select id, name from t500_edit order by id");
    await e.editCell(shown, h.conn, 1, 1, "bob c");
    const submitted = e.submit(shown, h.conn).catch((error: Error) => error.message);
    await terminate(await runningPid("COMMIT"));
    expect(await submitted).toMatch(/^Unknown whether the server committed 1 change.*Refresh/su);
    expect(e.pending(shown)).toBe(true);
    await server.admin("TRUNCATE t500_slow");
    // The server rolled it back (the trigger ran before the commit): the check finds it absent.
    expect(await server.admin("select name from t500_edit where id = 2")).toBe("bob");
  });
});
