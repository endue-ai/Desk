// A console keeps its PostgreSQL session between runs (PG-02, ADR 0320): what one run sets, the next
// sees; the header follows the session's state from the server's ReadyForQuery status; a transaction
// run or a dry run inside an open transaction is a savepoint; a session the server ended is said in
// words and opened again at the next run with nothing replayed; table views have sessions of their
// own, agents and the plugin's own reads short ones; Cancel stops the console on screen alone.
import { describe, expect, it } from "vitest";
import {
  closed,
  made,
  messages,
  PG,
  ranOn,
  run,
  sessionOf,
  shop,
  start,
  state,
} from "./session-helpers";

describe("a console's PostgreSQL session", () => {
  it("a console keeps its session: a SET, a temporary table and a transaction are seen by the next run", async () => {
    const m = await shop();
    const sqls = [
      "set search_path to audit",
      "create temporary table seen (id int)",
      "begin",
      "insert into seen values (1)",
      "select * from seen",
      "commit",
    ];
    for (const sql of sqls) await run(m, sql);
    const id = sessionOf(m, "set search_path to audit");
    expect(ranOn(m, id)).toEqual(sqls);
    expect(closed(m)).not.toContain(id);
  });

  it("the header follows the session: not connected, running, idle, in a transaction, in a failed transaction", async () => {
    const m = await shop();
    expect(m.shown()?.session).toMatchObject({ state: "none", label: "Not connected" });
    await run(m, "select 1");
    expect(m.shown()?.session).toMatchObject({ state: "idle", label: "Idle" });
    await run(m, "begin");
    expect(m.shown()?.session).toMatchObject({ state: "open", label: "In a transaction" });
    await run(m, "select 1/0");
    expect(m.shown()?.session).toMatchObject({
      state: "failed",
      label: "In a failed transaction",
      detail: expect.stringMatching(/ROLLBACK/u),
    });
    await run(m, "select 1");
    expect(messages(m).join("\n")).toMatch(/25P02/u);
    await run(m, "rollback");
    expect(state(m)).toBe("idle");

    const going = await start(m, "select pg_sleep(60)");
    expect(m.shown()?.session).toMatchObject({ state: "running", label: "Running" });
    await m.host.command("endue.database.cancel");
    await going.done;
    await m.settle();
    expect(state(m)).toBe("idle");
  });

  it("In a transaction and Dry run inside an open transaction use a savepoint, and a failed one refuses them", async () => {
    const m = await shop();
    await run(m, "begin");
    await run(m, "insert into seen values (1)", "endue.database.run-transaction");
    await run(m, "insert into seen values (2)", "endue.database.dry-run");
    const id = sessionOf(m, "begin");
    expect(ranOn(m, id)).toEqual([
      "begin",
      "SAVEPOINT endue_desk",
      "insert into seen values (1)",
      "RELEASE SAVEPOINT endue_desk",
      "SAVEPOINT endue_desk",
      "insert into seen values (2)",
      "ROLLBACK TO SAVEPOINT endue_desk",
      "RELEASE SAVEPOINT endue_desk",
    ]);
    expect(state(m)).toBe("open");
    expect(messages(m).join("\n")).toMatch(/savepoint/iu);

    await run(m, "select 1/0");
    const before = ranOn(m, id).length;
    await run(m, "insert into seen values (3)", "endue.database.run-transaction");
    expect(ranOn(m, id)).toHaveLength(before);
    expect(messages(m).join("\n")).toMatch(/ROLLBACK first/u);
    expect(state(m)).toBe("failed");
  });

  it("a session the server ended is lost in words, its transaction reported, and the next run opens a new one without replaying", async () => {
    // An agent's pg_terminate_backend is a write (ADR 0328): the person says yes to it.
    const m = await shop({ pick: () => "yes" });
    await run(m, "set search_path to audit");
    await run(m, "begin");
    const first = sessionOf(m, "begin");
    const pid = m.shown()?.session?.pid;
    expect(pid).toBeGreaterThan(0);
    // Another session ends it, as pg_terminate_backend does on the server.
    await m.host.invoke("endue.database.query", {
      connection: "Shop",
      sql: `select pg_terminate_backend(${pid})`,
    });
    expect(m.picks.at(-1)?.title).toBe("Run this statement on Shop?");
    await m.settle();
    expect(m.shown()?.session).toMatchObject({
      state: "lost",
      label: "Session lost",
      detail: expect.stringMatching(/terminating connection.*rolled back/su),
    });
    expect(m.view.said.join("\n")).toMatch(/Shop.*lost.*rolled back/su);

    await run(m, "select * from seen");
    const second = sessionOf(m, "select * from seen");
    expect(second).not.toBe(first);
    expect(ranOn(m, second)).toEqual(["select * from seen"]);
    expect(messages(m).join("\n")).toMatch(
      /new session.*SET, temporary tables and prepared statements are gone/su,
    );
    expect(state(m)).toBe("idle");

    // The network goes: the next run opens a new one again.
    m.host.emit({
      event: "db.closed",
      data: { sessionId: second ?? "", reason: "io", message: "connection reset by peer" },
    });
    await m.settle();
    expect(m.shown()?.session?.detail).toMatch(/connection reset by peer/u);
    await run(m, "select 2");
    expect([sessionOf(m, "select 2")]).not.toContain(second);
  });

  it("each console and table view has its own session; agents, the catalog and counts keep short ones", async () => {
    const m = await shop();
    await run(m, "select 1");
    await m.host.command("endue.database.new-console", { connection: "Shop" });
    await run(m, "select 2");
    await m.host.command("endue.database.open-table", {
      connection: "Shop",
      schema: "public",
      table: "items",
    });
    await m.settle();
    const page = made(m, "db.run").find((p) => String(p.sql).includes('"public"."items"'));
    const ids = [sessionOf(m, "select 1"), sessionOf(m, "select 2"), page?.sessionId];
    expect(new Set(ids).size).toBe(3);
    expect(closed(m).filter((id) => ids.includes(id as string))).toEqual([]);

    await m.host.invoke("endue.database.query", { connection: "Shop", sql: "select 3" });
    const agent = sessionOf(m, "select 3");
    expect(ids).not.toContain(agent);
    expect(closed(m)).toContain(agent);

    await m.host.command("endue.database.consoles", { console: "Shop" });
    await run(m, "select 4");
    expect(sessionOf(m, "select 4")).toBe(ids[0]);
  });

  it("Cancel stops the statement of the console on screen only", async () => {
    const m = await shop();
    const one = await start(m, "select pg_sleep(60)");
    await m.host.command("endue.database.new-console", { connection: PG.name });
    const two = await start(m, "select pg_sleep(61)");
    await m.host.command("endue.database.cancel");
    await two.done;
    const second = sessionOf(m, "select pg_sleep(61)");
    expect(made(m, "db.cancel").map((p) => p.sessionId)).toEqual([second]);

    await m.host.command("endue.database.consoles", { console: "Shop" });
    await m.host.command("endue.database.cancel");
    await one.done;
    expect(made(m, "db.cancel").map((p) => p.sessionId)).toEqual([
      second,
      sessionOf(m, "select pg_sleep(60)"),
    ]);
  });
});
