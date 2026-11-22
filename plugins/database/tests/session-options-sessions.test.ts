// A connection's session options on a scripted server (PG-12): every session the plugin opens for it
// (a short run, a console's kept session, a table view's, the one a console opens after its first
// was lost) signs in with them as startup parameters and runs the startup script before anything
// else; a startup statement that fails ends the run in words and closes that session; a changed
// option closes the connection's sessions on Save; and completion, problems and the explorer read
// unqualified names on the connection's search path, as its role.
import { describe, expect, it } from "vitest";
import { defaultSchema } from "../ui/catalog.js";
import type { Connection } from "../ui/engines/common.js";
import { createCompletion } from "../ui/features/completion/controller.js";
import { feature as problems } from "../ui/features/problems/index.js";
import { closed, made, messages, PG, ranOn, run, sessionOf, shop } from "./session-helpers";

const OPTIONS = {
  searchPath: "app, public",
  role: "reporting",
  timeZone: "Asia/Seoul",
  lockTimeout: "5s",
  idleTimeout: "1min",
  applicationName: "shop report",
  startup: "set work_mem = '64MB';\nselect set_config('app.tenant', '7', false)",
};
const SHOP = { ...PG, ...OPTIONS } as Connection;
const STARTUP = ["set work_mem = '64MB'", "select set_config('app.tenant', '7', false)"];
const SETTINGS = {
  search_path: "app, public",
  role: "reporting",
  TimeZone: "Asia/Seoul",
  lock_timeout: "5s",
  idle_in_transaction_session_timeout: "1min",
  application_name: "shop report",
};

type Opened = { settings?: Record<string, string> };
/** The settings each db.open asked for, in order. */
const opens = (m: Awaited<ReturnType<typeof shop>>) =>
  made(m, "db.open").map((p) => (p as Opened).settings ?? {});

describe("a connection's session options on every session", () => {
  it("a console's session, a table view's, a short run and the session after a loss", async () => {
    const m = await shop({ pick: () => "yes" }, [SHOP]);
    await run(m, "select 1");
    const kept = sessionOf(m, "select 1");
    expect(ranOn(m, kept)).toEqual([...STARTUP, "select 1"]);
    await run(m, "select 2");
    // The kept session ran the script once, at its sign-in.
    expect(ranOn(m, kept)).toEqual([...STARTUP, "select 1", "select 2"]);

    await m.host.command("endue.database.open-table", {
      connection: "Shop",
      schema: "app",
      table: "items",
    });
    await m.settle();
    const page = made(m, "db.run").find((p) => String(p.sql).includes('"app"."items"'));
    expect(ranOn(m, page?.sessionId as string).slice(0, 2)).toEqual(STARTUP);

    await m.host.invoke("endue.database.query", { connection: "Shop", sql: "select 3" });
    const short = sessionOf(m, "select 3");
    expect(ranOn(m, short)).toEqual([...STARTUP, "select 3"]);
    expect(closed(m)).toContain(short);

    // The console's session is lost: the next run signs in again, with the options and the script.
    m.host.emit({
      event: "db.closed",
      data: { sessionId: kept ?? "", reason: "io", message: "connection reset by peer" },
    });
    await m.settle();
    await m.host.command("endue.database.consoles", { console: "Shop" });
    await run(m, "select 4");
    const again = sessionOf(m, "select 4");
    expect(again).not.toBe(kept);
    expect(ranOn(m, again)).toEqual([...STARTUP, "select 4"]);

    const all = opens(m);
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const settings of all) expect(settings).toMatchObject(SETTINGS);
  });

  it("a connection without options signs in as before and runs nothing first", async () => {
    const m = await shop();
    await run(m, "select 1");
    expect(ranOn(m, sessionOf(m, "select 1"))).toEqual(["select 1"]);
    expect(opens(m)[0]).toEqual({ application_name: "endue Desk", DateStyle: "ISO" });
  });

  it("a startup statement that fails ends the run in words and closes the session", async () => {
    const bad = { ...SHOP, startup: "set work_mem = '64MB';\nset app.missing_fn = nope()" };
    // The scripted server fails the second startup statement.
    const failing = (sql: string) =>
      sql.startsWith("set app.missing_fn")
        ? { error: "function nope() does not exist", code: "42883" }
        : {};
    const m = await shop({ script: failing }, [bad as Connection]);
    await run(m, "select 1");
    expect(sessionOf(m, "select 1")).toBeUndefined();
    const opened = made(m, "db.run").find((p) => String(p.sql).startsWith("set app.missing_fn"));
    expect(closed(m)).toContain(opened?.sessionId);
    expect(messages(m).join("\n")).toMatch(
      /Shop's startup script, statement 2: function nope\(\) does not exist/u,
    );
  });

  it("a changed option closes the connection's sessions on Save", async () => {
    const m = await shop({ pick: () => "yes" }, [SHOP]);
    await run(m, "select 1");
    const one = sessionOf(m, "select 1");
    await m.host.command("endue.database.edit-connection", { connection: "Shop" });
    await m.app.formSave({ ...m.view.forms.at(-1)?.fields, searchPath: "audit" });
    await m.settle();
    expect(closed(m)).toContain(one);
    await run(m, "select 2");
    expect(opens(m).at(-1)?.search_path).toBe("audit");
  });
});

describe("names without a schema, read on the connection's search path", () => {
  const conn = { ...PG, searchPath: '"Sales", app', role: "reporting" } as Connection;
  const deps = {
    consoles: { current: () => ({ id: "k-1", kind: "console", connection: conn.id }) },
    manager: { get: () => conn },
    catalog: { cache: { view: () => null } },
    settings: () => ({
      problemsNames: false,
      problemsWarnings: false,
      problemsSyntax: true,
      problemsWarningsOff: [],
      snippets: [],
    }),
    bridge: { call: async () => ({}) },
  };

  it("the explorer's schema of a name without one is the path's first", () => {
    expect(defaultSchema(conn)).toBe("Sales");
    expect(defaultSchema(PG)).toBe("public");
    expect(defaultSchema({ ...PG, searchPath: "$user, app" } as Connection)).toBe("app");
  });

  it("problems check against the path and the role", () => {
    const actions = problems.actions?.(deps as never) as Record<string, () => unknown>;
    const context = actions.problemsContext?.() as { searchPath: string[]; user: string };
    expect(context.searchPath).toEqual(["Sales", "app"]);
    expect(context.user).toBe("reporting");
  });

  it("completion completes on the path and the role", async () => {
    let asked: { searchPath?: string[]; user?: string } = {};
    const parser = () => ({
      complete: async (_t: string, _m: unknown, options: typeof asked) => {
        asked = options;
        return { items: [], from: 0, to: 0 };
      },
    });
    const completion = createCompletion(deps as never, parser as never);
    const text = "do $$ begin perform x; end $$";
    await completion.complete(text, text.indexOf("x") + 1);
    expect(asked.searchPath).toEqual(["Sales", "app"]);
    expect(asked.user).toBe("reporting");
  });
});
