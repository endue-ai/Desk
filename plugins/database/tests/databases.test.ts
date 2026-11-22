// PG-13: one PostgreSQL connection shows every database of its server. The explorer lists them
// under the connection (its own first and open, templates only on request) from the schema cache's
// pass, reads another one only when it opens, with the same password, and a database that refuses
// says so on its own row. A console and a table view say which database they are on and switch,
// which closes the buffer's session (PG-02), asking first in a transaction; history, starred
// queries and the keychain's password stay with the connection, each entry naming its database;
// agents name a database; another database's cache is kept apart and goes with the connection.
import { describe, expect, it } from "vitest";
import { storeIdOf } from "../ui/databases.js";
import type { Node } from "../ui/explorer.js";
import type { Feature } from "../ui/feature-host.js";
import * as builtins from "../ui/features/index.js";
import { databasesKey, indexKey } from "../ui/schema-cache/store.js";
import type { Script } from "./clients";
import { databasesScript, REFUSED } from "./databases-fixture";
import { type Mounted, mount, SAVED } from "./harness";
import { kindOf } from "./pg-catalog";
import { closed, run, sessionOf } from "./session-helpers";

/** A first pass: the fingerprints, the nine per-schema readers, the database level's two. */
const PASS = [
  "marks",
  "relations",
  "columns",
  "constraints",
  "indexes",
  "triggers",
  "routines",
  "types",
  "objects",
  "table parts",
  "database",
  "server",
];
const ANALYTICS = "c-prod/analytics";
const table = { connection: "Shop", schema: "public", table: "people" };
type Deps = Parameters<NonNullable<Feature["commands"]>>[0];

const tree = (m: Mounted) => m.view.trees.at(-1) ?? [];
const row = (m: Mounted, label: string, under?: Node, kind?: string) =>
  tree(m).find(
    (r) =>
      r.label === label &&
      (!kind || r.kind === kind) &&
      (!under || r.key.startsWith(`${under.key}\u0000`)),
  );
const children = (m: Mounted, node: Node | undefined) =>
  tree(m)
    .filter((r) => node && r.key.startsWith(`${node.key}\u0000`) && r.level === node.level + 1)
    .map((r) => (r.detail ? `${r.label} · ${r.detail}` : r.label));
async function until(m: Mounted, test: () => unknown) {
  for (let i = 0; i < 80 && !test(); i++) await m.settle();
  expect(test()).toBeTruthy();
}
/** Open rows by label, each under the one before; answers the last. */
async function open(m: Mounted, ...labels: string[]) {
  let at: Node | undefined;
  for (const label of labels) {
    const under = at;
    await until(m, () => row(m, label, under));
    at = row(m, label, under) as Node;
    m.app.toggle(at, true);
    await m.settle();
  }
  return tree(m).find((r) => r.key === at?.key) as Node;
}
/** The SQL of every PostgreSQL run (a session each), in order. */
const ran = (m: Mounted) => m.sessions().map((sqls) => sqls[0] ?? "");
/** The database each db.open signed in to, and with which password. */
const opens = (m: Mounted) =>
  m.host.calls
    .filter((c) => c.method === "db.open")
    .map((c) => c.params as { database: string; password?: string });

/** The scripted server of several databases, every other statement seen with its database. */
function server() {
  const seen: [string, string][] = [];
  const other: Script = (sql, who) => {
    seen.push([who.database ?? "", sql]);
    if (sql === "select current_database()") return { rows: [["db"], [who.database ?? ""]] };
    return /^select \d/u.test(sql) ? { rows: [["n"], ["1"]] } : {};
  };
  return { seen, script: databasesScript(other) };
}

async function mounted(more: Parameters<typeof mount>[0] = {}) {
  const { seen, script } = server();
  const m = await mount({
    store: { connections: SAVED },
    script,
    pick: () => "yes",
    ...more,
  });
  return { m, seen };
}

describe("one PostgreSQL connection shows every database of its server", () => {
  it("lists the server's databases under a PostgreSQL connection, its own first and open", async () => {
    const { m } = await mounted();
    const shop = await open(m, "Shop");
    await until(m, () => row(m, "analytics", shop));
    expect(children(m, shop)).toEqual(["shop · the connection's", "analytics", "locked"]);
    const own = row(m, "shop", shop, "database") as Node;
    expect(own).toMatchObject({ expanded: true, connection: "c-prod", database: "shop" });
    await until(m, () => row(m, "Server", own));
    expect(children(m, own)).toEqual(["public", "sales", "Database · shop", "Server"]);
    // The list came with the cache's pass: no statement more, and only the own database opened.
    expect(ran(m).map(kindOf)).toEqual(PASS);
    expect(new Set(opens(m).map((o) => o.database))).toEqual(new Set(["shop"]));
    expect(row(m, "template1")).toBeUndefined();

    // The own database closes and opens again like any row.
    m.app.toggle(own, false);
    await m.settle();
    expect(row(m, "public", shop)).toBeUndefined();
    m.app.toggle(row(m, "shop", shop, "database") as Node, true);
    await m.settle();
    expect(row(m, "public", shop)).toBeDefined();

    // Templates are listed with the system-schemas setting.
    const shown = await mount({
      store: { connections: SAVED },
      script: server().script,
      settings: { "system-schemas": true },
    });
    const server2 = await open(shown, "Shop");
    await until(shown, () => row(shown, "template1", server2));
    expect(children(shown, server2)).toEqual([
      "shop · the connection's",
      "analytics",
      "locked",
      "template1 · template",
    ]);
  });

  it("opens another database lazily, with the same credentials", async () => {
    const { m } = await mounted({ password: "s3cret" });
    const shop = await open(m, "Shop");
    await until(m, () => m.view.passwords.at(-1));
    m.app.password("s3cret");
    await until(m, () => row(m, "analytics", shop));
    expect(opens(m).some((o) => o.database === "analytics")).toBe(false);

    const metrics = await open(m, "Shop", "analytics", "metrics");
    expect(metrics.connection).toBe(ANALYTICS);
    const tables = await open(m, "Shop", "analytics", "metrics", "Tables");
    expect(children(m, tables)).toEqual(["visits · ~12 rows"]);
    const of = opens(m).filter((o) => o.database === "analytics");
    expect(of.length).toBeGreaterThan(0);
    expect(of.every((o) => o.password === "s3cret")).toBe(true);
    expect(m.view.passwords.filter(Boolean)).toHaveLength(1);
    expect(row(m, "analytics", shop)?.detail).toMatch(/^read \d\d:\d\d$/u);
  });

  it("a database that refuses says so on its own row", async () => {
    const { m } = await mounted();
    const shop = await open(m, "Shop");
    const locked = await open(m, "Shop", "locked");
    await until(m, () => row(m, "locked", shop)?.error);
    expect(children(m, locked)).toEqual([expect.stringContaining(REFUSED)]);
    expect(
      tree(m).find((r) => r.kind === "info" && r.key.startsWith(`${locked.key}\u0000`)),
    ).toMatchObject({ error: true });
    // The connection's own database and the third one still read.
    expect(row(m, "public", shop)).toBeDefined();
    expect(row(m, "Shop")?.error).toBeUndefined();
    await open(m, "Shop", "analytics", "metrics");
    expect(row(m, "metrics", shop)).toBeDefined();
  });

  it("a console and a table view say which database they are on and switch", async () => {
    const { m, seen } = await mounted({
      pick: (asked) => (asked.title.startsWith("Database: move it") ? "shop" : "yes"),
    });
    const visits = await open(m, "Shop", "analytics", "metrics", "Tables", "visits");
    await m.app.activate(visits);
    await m.settle();
    expect(m.shown()).toMatchObject({ kind: "table", connection: ANALYTICS });
    expect(m.shown()?.name).toBe("db: Shop/analytics · metrics.visits");
    expect(m.view.consoles.at(-1)?.conn).toMatchObject({
      name: "Shop/analytics",
      database: "analytics",
    });
    // Its page was read on analytics, which alone has the table.
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([
      ["1", "/"],
      ["2", "/pricing"],
      ["3", "/docs"],
    ]);

    // A console moves to another database of its server, its id and text kept.
    await m.host.command("endue.database.console", { connection: "Shop" });
    m.view.text = "select 1";
    m.app.edited("select 1");
    const before = m.shown();
    expect(m.view.consoles.at(-1)?.conn?.database).toBe("shop");
    await m.host.command("endue.database.switch-database", { database: "analytics" });
    expect(m.shown()).toMatchObject({
      connection: ANALYTICS,
      name: "db: Shop/analytics",
      consoleId: before?.consoleId,
      text: "select 1",
    });
    expect(m.view.consoles.at(-1)?.conn?.database).toBe("analytics");
    await m.host.command("endue.database.run");
    await m.settle();
    expect(seen.at(-1)).toEqual(["analytics", "select 1"]);

    // Picked from the server's databases, the connection's own first.
    await m.host.command("endue.database.switch-database");
    expect(m.picks.at(-1)?.items.map((i) => i.label)).toEqual(["shop", "✓ analytics", "locked"]);
    expect(m.shown()).toMatchObject({ connection: "c-prod", name: "db: Shop" });
  });

  it("a switch closes the console's or table view's session, asking first in a transaction", async () => {
    const answers: string[] = [];
    const { m } = await mounted({ pick: () => answers.shift() ?? "" });
    await m.host.command("endue.database.console", { connection: "Shop" });
    await run(m, "begin");
    const old = sessionOf(m, "begin");
    const to = (database: string) => m.host.command("endue.database.switch-database", { database });
    answers.push("no");
    await expect(to("analytics")).rejects.toThrow(/Not moved/u);
    expect(m.picks.at(-1)?.title).toBe("Move it to Shop/analytics?");
    expect(closed(m)).not.toContain(old);
    answers.push("yes");
    await to("analytics");
    await m.settle();
    expect(closed(m)).toContain(old);
    await run(m, "select current_database()");
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([["analytics"]]);
    expect(sessionOf(m, "select current_database()")).not.toBe(old);

    // A table view's session closes too, without a question when it is idle.
    await m.host.command("endue.database.open-table", table);
    await m.settle();
    const page = m.host.calls.find(
      (c) =>
        c.method === "db.run" && String((c.params as { sql: string }).sql).includes('"people"'),
    )?.params as { sessionId: string } | undefined;
    const asks = m.picks.length;
    await to("analytics");
    await m.settle();
    expect(m.picks).toHaveLength(asks);
    expect(closed(m)).toContain(page?.sessionId);
  });

  it("history and starred queries stay with the connection, the database recorded", async () => {
    const { m } = await mounted();
    await m.host.command("endue.database.console", { connection: "Shop" });
    await m.host.command("endue.database.switch-database", { database: "analytics" });
    m.view.text = "select 1";
    m.app.edited("select 1");
    await m.host.command("endue.database.run");
    await m.settle();
    expect(m.store["history:c-prod"]).toEqual([
      expect.objectContaining({ sql: "select 1", database: "analytics" }),
    ]);
    expect(m.store[`history:${ANALYTICS}`]).toBeUndefined();
    await m.host.command("endue.database.star", { name: "one" });
    expect(m.store["saved:c-prod"]).toEqual([
      expect.objectContaining({ name: "one", sql: "select 1", database: "analytics" }),
    ]);
    await m.host.command("endue.database.history");
    const first = m.picks.at(-1)?.items[0] as { detail?: string } | undefined;
    expect(first?.detail).toContain("analytics · ");

    // The console's text is the console's, and it comes back on its database after a restart.
    await m.settle();
    await new Promise((resolve) => setTimeout(resolve, 450));
    const after = await mount({ store: m.store, state: m.host.state, script: server().script });
    expect(after.shown()).toMatchObject({
      connection: ANALYTICS,
      name: "db: Shop/analytics",
      consoleId: "c-prod",
      text: "select 1",
    });
  });

  it("keeps one password in the keychain for every database of the server", async () => {
    let deps: Deps | undefined;
    const probe: Feature = {
      id: "probe",
      commands: (given) => {
        deps = given;
        return {};
      },
    };
    const { m } = await mounted({
      password: "s3cret",
      features: [...Object.values(builtins), probe],
    });
    await m.host.command("endue.database.console", { connection: "Shop" });
    await m.host.command("endue.database.switch-database", { database: "analytics" });
    expect(m.view.passwords).toEqual([]);
    m.view.text = "select 1";
    const running = m.host.command("endue.database.run");
    await until(m, () => m.view.passwords.at(-1));
    expect(m.view.passwords.at(-1)).toMatchObject({ connection: "Shop/analytics" });
    m.app.password("s3cret", true);
    await running;
    await m.settle();
    const saved = m.store.connections as Array<{ id: string; keychain?: boolean }>;
    expect(saved.map((c) => [c.id, c.keychain])).toEqual([
      ["c-lite", undefined],
      ["c-prod", true],
    ]);
    const kept = (await deps?.bridge.call("db.passwords.list", {}))?.passwords;
    expect(kept?.map((p: { name: string }) => p.name)).toEqual(["c-prod"]);
    const on = deps?.manager.get(ANALYTICS);
    expect(on && deps?.manager.passwords.ref(on)).toBe("c-prod");
  });

  it("agents name a database", async () => {
    const { m, seen } = await mounted();
    expect(await m.host.invoke("endue.database.schema", { connection: "Shop" })).toEqual({
      schemas: ["public", "sales"],
      databases: ["analytics", "locked", "shop"],
    });
    expect(
      await m.host.invoke("endue.database.schema", { connection: "Shop", database: "analytics" }),
    ).toEqual({ schemas: ["metrics"], databases: ["analytics", "locked", "shop"] });
    expect(
      await m.host.invoke("endue.database.schema", {
        connection: "Shop",
        database: "analytics",
        schema: "metrics",
      }),
    ).toEqual({ tables: [{ name: "visits", type: "table", rows: 12 }] });
    const answer = await m.host.invoke("endue.database.query", {
      connection: "Shop",
      database: "analytics",
      sql: "select 2",
    });
    expect(answer).toMatchObject({ statements: [{ ran: true }] });
    expect(seen.at(-1)).toEqual(["analytics", "select 2"]);
    await expect(
      m.host.invoke("endue.database.query", {
        connection: "Notes",
        database: "x",
        sql: "select 1",
      }),
    ).rejects.toThrow(/not PostgreSQL/u);
    expect(m.view.passwords).toEqual([]);
  });

  it("another database's cache is kept apart and goes with the connection", async () => {
    const { m } = await mounted();
    await open(m, "Shop", "analytics", "metrics");
    await m.settle();
    const id = storeIdOf(ANALYTICS);
    expect(id).toMatch(/^c-prod\.d-[a-z0-9]+$/u);
    expect(m.store[indexKey(id)]).toMatchObject({ where: expect.stringContaining("|analytics|") });
    expect(m.store[indexKey("c-prod")]).toMatchObject({ where: expect.stringContaining("|shop|") });
    expect(m.store[databasesKey("c-prod")]).toEqual([id]);

    // After a restart it answers from the store and only checks its fingerprints.
    const again = await mount({
      store: { ...m.store },
      script: server().script,
      pick: () => "yes",
    });
    expect(
      await again.host.invoke("endue.database.schema", {
        connection: "Shop",
        database: "analytics",
        schema: "metrics",
      }),
    ).toEqual({ tables: [{ name: "visits", type: "table", rows: 12 }] });
    await again.settle();
    expect(new Set(ran(again).map(kindOf))).toEqual(new Set(["marks"]));

    await again.host.command("endue.database.remove-connection", { connection: "Shop" });
    for (const key of [indexKey(id), indexKey("c-prod"), databasesKey("c-prod")])
      expect(again.store[key] ?? null).toBeNull();
    expect(again.store[`${indexKey(id)}.0`] ?? null).toBeNull();
  });
});
