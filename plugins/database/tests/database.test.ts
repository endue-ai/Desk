import { describe, expect, it } from "vitest";
import { mount, SAVED } from "./harness";

const sqliteRuns = (spawned: Array<{ command: string; args: string[] }>) =>
  spawned.filter((s) => s.command === "sqlite3" && s.args[0] !== "--version");

describe("connections", () => {
  it("opens the form when there is no connection yet, and keeps a saved one without a password", async () => {
    const m = await mount();
    await m.host.command("endue.database.open");
    await m.settle();
    expect(m.view.forms.at(-1)).toMatchObject({ mode: "new", error: "" });
    await m.app.formSave({ engine: "sqlite", name: "Scratch", file: "~/scratch.db" });
    await m.settle();
    const kept = m.store.connections as Array<Record<string, unknown>>;
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ name: "Scratch", engine: "sqlite", file: "~/scratch.db" });
    expect(JSON.stringify(m.store)).not.toMatch(/password/iu);
    expect(m.view.forms.at(-1)).toBeNull();
    expect(m.view.trees.at(-1)?.map((row) => row.label)).toEqual(["Scratch"]);
  });

  it("says what is wrong in the form and keeps it open", async () => {
    const m = await mount();
    m.app.create();
    await m.app.formSave({ engine: "sqlite", name: "Bad", file: "relative.db" });
    await m.settle();
    expect(m.view.forms.at(-1)?.error).toBe("File: a full path, starting with / or ~/.");
    expect(m.store.connections).toBeUndefined();
  });

  it("uses a URI's password for the session and never keeps it", async () => {
    const m = await mount({ script: () => ({ rows: [["version"], ["PostgreSQL 17.6"]] }) });
    await m.host.command("endue.database.import-uri", {
      uri: "postgresql://app:s3cret@db.example:6543/shop?sslmode=require",
    });
    await m.settle();
    expect(m.view.forms.at(-1)).toMatchObject({
      fields: { host: "db.example", port: 6543, database: "shop", user: "app", ssl: "require" },
    });
    await m.app.formSave({ ...m.view.forms.at(-1)?.fields, name: "Shop" });
    await m.settle();
    expect(JSON.stringify(m.store)).not.toContain("s3cret");
    await m.host.command("endue.database.test-connection", { connection: "Shop" });
    const run = m.clients.spawned.find((s) => s.command === "psql" && s.args[0] !== "--version");
    expect(run?.env.PGPASSWORD).toBe("s3cret");
    expect(run?.args.join(" ")).not.toContain("s3cret");
    expect(JSON.stringify(m.host.state)).not.toContain("s3cret");
  });

  it("asks for a password when psql says one is missing, and runs again with it", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: (_sql, env) =>
        env.PGPASSWORD === "typed" ? { rows: [["?column?"], ["1"]] } : "auth",
      pick: () => "yes",
    });
    await m.host.command("endue.database.console", { connection: "Shop" });
    m.view.text = "select 1";
    const running = m.host.command("endue.database.run");
    await m.settle();
    expect(m.view.passwords.at(-1)).toMatchObject({ connection: "Shop" });
    m.app.password("typed");
    await running;
    await m.settle();
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([["1"]]);
    expect(m.view.passwords.at(-1)).toBeNull();
    expect(JSON.stringify(m.store)).not.toContain("typed");
  });
});

describe("consoles", () => {
  it("runs the statement at the caret and shows its rows, then keeps it in the history", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: (sql) =>
        sql === "select * from notes"
          ? {
              rows: [
                ["id", "body"],
                ["1", "a"],
                ["2", "NULL"],
              ],
            }
          : {},
    });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "create table t (a);\nselect * from notes;";
    m.view.caret = m.view.text.length - 3;
    await m.host.command("endue.database.run");
    await m.settle();
    const runs = sqliteRuns(m.clients.spawned);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.args).toContain("select * from notes");
    expect(runs[0]?.args).not.toContain("create table t (a)");
    expect(runs[0]?.args.slice(0, 3)).toEqual(["-safe", "-batch", "-bail"]);
    const shown = m.shown()?.shown;
    expect(shown?.tabs[0]?.set).toMatchObject({
      columns: ["id", "body"],
      rows: [
        ["1", "a"],
        ["2", "NULL"],
      ],
    });
    expect(shown?.summary).toMatch(/^Done: 1 of 1 statement ran in \d+ ms$/u);
    const history = m.store["history:c-lite"] as Array<{ sql: string; ok: boolean }>;
    expect(history[0]).toMatchObject({ sql: "select * from notes", ok: true });
    expect(m.host.ran.find((r) => r.name === "desk.buffers.open")?.args).toEqual({
      name: "db: Notes",
    });
  });

  it("refuses a write on a read-only connection without starting the client", async () => {
    const readOnly = [{ ...SAVED[0], readOnly: true }];
    const m = await mount({ store: { connections: readOnly } });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "insert into t values (1)";
    await expect(m.host.command("endue.database.run-all")).rejects.toThrow(/read-only/u);
    expect(sqliteRuns(m.clients.spawned)).toHaveLength(0);
  });

  it("asks before a write on a production connection and runs nothing on No", async () => {
    const m = await mount({ store: { connections: SAVED }, pick: () => "no" });
    await m.host.command("endue.database.console", { connection: "Shop" });
    m.view.text = "update orders set paid = true where id = 7";
    await expect(m.host.command("endue.database.run-all")).rejects.toThrow(/Not run/u);
    expect(m.picks.at(-1)?.title).toBe("Run this statement on Shop?");
    expect(m.picks.at(-1)?.items.map((i) => i.label)).toContain("No");
    expect(
      m.clients.spawned.filter((s) => s.command === "psql" && s.args[0] !== "--version"),
    ).toHaveLength(0);
  });

  it("asks before DELETE without WHERE anywhere, unless confirm is off", async () => {
    const asked = await mount({
      store: { connections: SAVED },
      pick: () => "yes",
      script: () => ({ changes: 3 }),
    });
    await asked.host.command("endue.database.console", { connection: "Notes" });
    asked.view.text = "delete from notes";
    await asked.host.command("endue.database.run-all");
    expect(asked.picks.at(-1)?.items[0]).toMatchObject({
      detail: "Statement 1: DELETE without WHERE changes every row.",
    });
    expect(asked.shown()?.shown?.tabs.at(-1)?.lines?.[0]?.text).toBe("DELETE: 3 rows affected");
    const quiet = await mount({
      store: { connections: SAVED },
      init: { "endue.database.confirm": false },
    });
    await quiet.host.command("endue.database.console", { connection: "Notes" });
    quiet.view.text = "delete from notes";
    await quiet.host.command("endue.database.run-all");
    expect(quiet.picks).toHaveLength(0);
  });

  it("shows the first error, leaves the rest not run, and refuses dot-commands", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: (sql) => (sql.startsWith("selec ") ? { error: 'near "selec": syntax error' } : {}),
    });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "create table a (x);\nselec 1;\ncreate table b (y);";
    await m.host.command("endue.database.run-all");
    await m.settle();
    const lines = m
      .shown()
      ?.shown?.tabs.at(-1)
      ?.lines?.map((l) => [l.level, l.text]);
    expect(lines).toEqual([
      ["ok", "1. CREATE: 0 rows affected"],
      ["error", '2. near "selec": syntax error'],
      ["skipped", "3. CREATE: not run"],
    ]);
    m.view.text = ".shell ls";
    await expect(m.host.command("endue.database.run-all")).rejects.toThrow(/dot-commands/u);
  });

  it("dry-runs a script inside BEGIN and ROLLBACK", async () => {
    const m = await mount({ store: { connections: SAVED }, script: () => ({ changes: 1 }) });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "insert into notes values (1)";
    await m.host.command("endue.database.dry-run");
    const args = sqliteRuns(m.clients.spawned)[0]?.args ?? [];
    expect(args.indexOf("BEGIN")).toBeLessThan(args.indexOf("insert into notes values (1)"));
    expect(args.at(-1)).toBe("ROLLBACK");
    expect(m.shown()?.shown?.summary).toMatch(/rolled back \(dry run\)$/u);
  });

  it("pages a table's rows and refuses a filter that could carry a second statement", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: () => ({ rows: [["id"], ["1"]] }),
    });
    await m.host.command("endue.database.open-table", {
      connection: "Notes",
      schema: "main",
      table: "notes",
    });
    await m.settle();
    expect(sqliteRuns(m.clients.spawned).at(-1)?.args).toContain(
      'SELECT * FROM "notes" LIMIT 500 OFFSET 0',
    );
    m.app.page({ where: "id > 1; drop table notes" });
    await m.settle();
    expect(m.view.said.at(-1)).toBe("Filter: one expression, without ; or unbalanced parentheses.");
    m.app.page({ where: "id > 1", order: "id desc" });
    await m.settle();
    expect(sqliteRuns(m.clients.spawned).at(-1)?.args).toContain(
      'SELECT * FROM "notes" WHERE id > 1 ORDER BY id desc LIMIT 500 OFFSET 0',
    );
  });

  it("opens a SQLite file the desk visits as a connection in that buffer", async () => {
    const m = await mount();
    await m.host.command("desk.files.visit", {
      buffer: "file:/data/app.sqlite",
      path: "/data/app.sqlite",
    });
    await m.settle();
    expect(m.store.connections).toMatchObject([
      { engine: "sqlite", file: "/data/app.sqlite", name: "app.sqlite" },
    ]);
    expect(m.shown()).toMatchObject({ id: "file:/data/app.sqlite", kind: "console" });
  });

  it("says how to install a client that is missing", async () => {
    const m = await mount({ store: { connections: SAVED }, missing: ["sqlite3"] });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "select 1";
    await m.host.command("endue.database.run");
    await m.settle();
    expect(m.shown()?.shown?.tabs.at(-1)?.lines?.[0]?.text).toMatch(
      /sqlite3 was not found\. .*brew install sqlite/u,
    );
  });
});

describe("agents", () => {
  it("registers its commands with argument schemas and answers a read", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: () => ({ rows: [["n"], ["42"]] }),
    });
    const registered = m.host.calls
      .filter((c) => c.method === "cmd.register")
      .map((c) => (c.params as { id: string }).id);
    expect(registered).toEqual([
      "endue.database.connections",
      "endue.database.schema",
      "endue.database.query",
    ]);
    const listed = (await m.host.invoke("endue.database.connections")) as Array<
      Record<string, unknown>
    >;
    expect(listed.map((c) => c.name)).toEqual(["Notes", "Shop"]);
    const answer = await m.host.invoke("endue.database.query", {
      connection: "Notes",
      sql: "select count(*) as n from notes",
    });
    expect(answer).toMatchObject({
      statements: [{ ran: true, results: [{ columns: ["n"], rows: [["42"]] }] }],
    });
    expect(m.picks).toHaveLength(0);
  });

  it("never shows an agent's request a password prompt", async () => {
    const m = await mount({ store: { connections: SAVED }, script: () => "auth" });
    await expect(m.host.invoke("endue.database.schema", { connection: "Shop" })).rejects.toThrow(
      /no password supplied/u,
    );
    await expect(
      m.host.invoke("endue.database.query", { connection: "Shop", sql: "select 1" }),
    ).rejects.toThrow(/no password supplied/u);
    expect(m.view.passwords).toEqual([]);
  });

  it("asks the person before an agent's write, even on a connection that is not production", async () => {
    const m = await mount({ store: { connections: SAVED }, pick: () => "no" });
    await expect(
      m.host.invoke("endue.database.query", {
        connection: "Notes",
        sql: "insert into notes values (1)",
      }),
    ).rejects.toThrow(/Not run/u);
    expect(m.picks.at(-1)?.items[0]).toMatchObject({ detail: "An agent asks to change data." });
    expect(sqliteRuns(m.clients.spawned)).toHaveLength(0);
  });
});
