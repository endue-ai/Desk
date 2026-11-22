// When a console's PostgreSQL session closes (PG-02, ADR 0320): with its console, on Disconnect, when
// the connection's sign-in changes and when it is removed, asking first while a transaction is open;
// after the person's idle minutes, never in a transaction; at the limit per connection, a table
// view's idle session first; and what a read-only connection and a frame that wakes open.
import { describe, expect, it } from "vitest";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { fromValues } from "../ui/settings.js";
import { type Handlers, mount, scriptedDb } from "./harness";
import { dbBridge } from "./pg-host";
import { closed, made, messages, PG, run, script, sessionOf, shop, state } from "./session-helpers";

const DB = [
  "db.open",
  "db.run",
  "db.script",
  "db.fetch",
  "db.copy",
  "db.cancel",
  "db.close",
  "db.list",
];
const table = (name: string) => ({ connection: "Shop", schema: "public", table: name });
const pageOf = (m: Awaited<ReturnType<typeof shop>>, name: string) =>
  made(m, "db.run").find((p) => String(p.sql).includes(`"public"."${name}"`))?.sessionId;

describe("when a console's session closes", () => {
  it("closing a console closes its session, and one in a transaction asks first and says it rolls back", async () => {
    const answers: string[] = [];
    const m = await shop({ pick: () => answers.shift() ?? "" });
    await run(m, "begin");
    const open = sessionOf(m, "begin");
    answers.push("no");
    await expect(m.host.command("endue.database.close-console")).rejects.toThrow(/Not closed/u);
    expect(closed(m)).not.toContain(open);
    const asked = m.picks.at(-1);
    expect(asked?.title).toBe("Close Shop?");
    expect(JSON.stringify(asked?.items)).toMatch(/Shop is in a transaction.*rolls it back/u);
    answers.push("yes");
    await m.host.command("endue.database.close-console");
    await m.settle();
    expect(closed(m)).toContain(open);

    // An idle console closes without a question.
    await m.host.command("endue.database.console", { connection: "Shop" });
    await run(m, "select 1");
    const asks = m.picks.length;
    await m.host.command("endue.database.close-console");
    await m.settle();
    expect(m.picks).toHaveLength(asks);
    expect(closed(m)).toContain(sessionOf(m, "select 1"));
  });

  it("Disconnect, a changed sign-in and removing the connection close its sessions", async () => {
    const answers: string[] = [];
    const m = await shop({ pick: () => answers.shift() ?? "yes" });
    await run(m, "select 1");
    const one = sessionOf(m, "select 1");
    // A new name signs in as before: the session stays.
    await m.host.command("endue.database.edit-connection", { connection: "Shop" });
    await m.app.formSave({ ...m.view.forms.at(-1)?.fields, name: "Shop main" });
    await run(m, "select 2");
    expect(sessionOf(m, "select 2")).toBe(one);
    expect(closed(m)).not.toContain(one);

    // Another database: asked first while a transaction is open, then closed.
    await run(m, "begin");
    await m.host.command("endue.database.edit-connection", { connection: "Shop main" });
    answers.push("no");
    await m.app.formSave({ ...m.view.forms.at(-1)?.fields, database: "audit" });
    expect(m.picks.at(-1)?.title).toBe("Save Shop main?");
    expect(closed(m)).not.toContain(one);
    answers.push("yes");
    await m.app.formSave({ ...m.view.forms.at(-1)?.fields, database: "audit" });
    await m.settle();
    expect(closed(m)).toContain(one);
    expect(state(m)).toBe("none");

    await run(m, "begin");
    const two = made(m, "db.run")
      .filter((p) => p.sql === "begin")
      .at(-1)?.sessionId;
    expect(two).not.toBe(one);
    answers.push("no");
    await expect(
      m.host.command("endue.database.disconnect", { connection: "Shop main" }),
    ).rejects.toThrow(/Not disconnected/u);
    expect(closed(m)).not.toContain(two);
    answers.push("yes");
    await m.host.command("endue.database.disconnect", { connection: "Shop main" });
    await m.settle();
    expect(closed(m)).toContain(two);
    expect(m.view.said.at(-1)).toMatch(/Disconnected Shop main: its sessions are closed/u);

    await run(m, "select 4");
    const three = sessionOf(m, "select 4");
    answers.push("yes");
    await m.host.command("endue.database.remove-connection", { connection: "Shop main" });
    await m.settle();
    expect(closed(m)).toContain(three);
  });

  it("an idle session closes after the person's minutes, never one in a transaction", async () => {
    const { bridge, calls } = dbBridge(scriptedDb(script), {
      grants: [{ permission: "db:connect", hosts: ["*"] }],
    });
    let clock = 0;
    let next = 0;
    const timers = new Map<number, { fn: () => void; at: number }>();
    const sessions = createSessions(bridge, {
      now: () => clock,
      setTimer: (fn: () => void, ms: number) => {
        timers.set(++next, { fn, at: clock + ms });
        return next;
      },
      clearTimer: (id: unknown) => void timers.delete(id as number),
      idleMs: () => 60_000,
    });
    const settings = fromValues({});
    const executor = createExecutor({
      runner: { run: async () => Promise.reject(new Error("no client")) },
      output: { read: async () => Promise.reject(new Error("nothing to read")) },
      clients: { get: async () => Promise.reject(new Error("no client")) },
      sessions,
      settings: () => settings,
      confirm: async () => true,
      passwords: { get: () => undefined, set: () => {}, ask: async () => undefined },
      cancelled: (message: string) => new Error(message),
    } as never);
    const exec = (sql: string, owner: string) =>
      executor.execute(PG, sql, { session: { owner, kind: "console" } });
    const idOf = (sql: string) =>
      calls.find((c) => c.method === "db.run" && c.params.sql === sql)?.params.sessionId;
    const closes = () =>
      calls.filter((c) => c.method === "db.close").map((c) => c.params.sessionId);

    await exec("select 1", "console:a");
    await exec("begin", "console:b");
    clock += 61_000;
    for (const [id, timer] of [...timers])
      if (timer.at <= clock) {
        timers.delete(id);
        timer.fn();
      }
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(closes()).toEqual([idOf("select 1")]);
    expect(sessions.state("console:a")).toMatchObject({
      state: "none",
      detail: expect.stringMatching(/1 minute idle/u),
    });
    expect(sessions.state("console:b").state).toBe("open");
    const again = await exec("select 2", "console:a");
    expect(idOf("select 2")).not.toBe(idOf("select 1"));
    expect(again.result.notices.join("\n")).toMatch(
      /closed after 1 minute idle.*SET, temporary tables and prepared statements are gone/su,
    );
  });

  it("the limit per connection: a table view's idle session goes first, then a clear message", async () => {
    const m = await shop({ settings: { "sessions-per-connection": 2 } });
    for (const name of ["items", "orders", "people"]) {
      await m.host.command("endue.database.open-table", table(name));
      await m.settle();
    }
    expect(closed(m)).toContain(pageOf(m, "items"));
    expect(closed(m)).not.toContain(pageOf(m, "people"));

    await m.host.command("endue.database.consoles", { console: "Shop" });
    await run(m, "select 1");
    await m.host.command("endue.database.new-console", { connection: "Shop" });
    await run(m, "select 2");
    expect(closed(m)).toContain(pageOf(m, "people"));
    const opens = made(m, "db.open").length;
    await m.host.command("endue.database.new-console", { connection: "Shop" });
    await run(m, "select 3");
    expect(made(m, "db.open")).toHaveLength(opens);
    expect(sessionOf(m, "select 3")).toBeUndefined();
    expect(messages(m).join("\n")).toMatch(
      /Shop keeps 2 sessions open, its limit \(Sessions per connection\): close a console or a table view of it/u,
    );
  });

  it("a read-only connection opens read-only sessions, and a woken frame finds its consoles' sessions again", async () => {
    const ro = await shop({}, [{ ...PG, readOnly: true }]);
    await run(ro, "select 1");
    expect(made(ro, "db.open").at(-1)).toMatchObject({ readOnly: true });

    const first = await shop();
    await run(first, "begin");
    const kept = sessionOf(first, "begin");
    await first.host.command("endue.database.open-table", table("items"));
    await first.settle();
    const orphan = pageOf(first, "items");
    // The frame sleeps: a new one starts with the state the first kept, on the same core.
    const relay = Object.fromEntries(
      DB.map((name) => [
        name,
        (params: unknown) => first.host.call(name as never, params as never, "endue.database"),
      ]),
    ) as Handlers;
    const second = await mount({
      store: first.store,
      script,
      state: first.host.state,
      handlers: relay,
    });
    await second.settle();
    expect(made(second, "db.list")).toHaveLength(1);
    expect(closed(second)).toEqual([orphan]);
    await second.host.command("endue.database.consoles", { console: "Shop" });
    expect(state(second)).toBe("open");
    await run(second, "commit");
    expect(sessionOf(second, "commit")).toBe(kept);
    expect(state(second)).toBe("idle");
  });
});
