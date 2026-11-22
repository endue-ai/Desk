// PG-80: the desk's palette finds database objects. Database: find objects (the plugin's palette
// provider) answers the tables, views, columns, routines, types and schemas of every PostgreSQL
// connection's caches, each database of its server, from memory or, after a restart, from the
// plugin's store, never from a server; each result says its connection, schema and kind, Enter
// opens it and Mod+Enter shows its DDL or copies its name; a hidden connection is left out.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isResults } from "../../palette/ui/providers.js";
import { databasesScript } from "./databases-fixture";
import { type Mounted, mount, SAVED } from "./harness";

type Result = {
  id: string;
  title: string;
  detail: string;
  kind: string;
  actions: { command: string; title: string; args: Record<string, unknown> }[];
};

const find = async (m: Mounted, query: string, limit = 5) => {
  const answer = await m.host.command("endue.database.find-objects", { query, limit });
  expect(isResults(answer), JSON.stringify(answer)).toBe(true);
  return (answer as { results: Result[] }).results;
};
const first = async (m: Mounted, query: string) => (await find(m, query))[0];
const runs = (m: Mounted) =>
  m.host.calls.filter((c) => c.method === "db.run" || c.method === "db.open").length;

/** The shop's server, both its databases' caches read. */
async function cached() {
  const m = await mount({
    store: { connections: SAVED },
    script: databasesScript(),
    pick: () => "yes",
  });
  await m.host.command("endue.database.reload-schema", { connection: "Shop" });
  await m.host.command("endue.database.reload-schema", { connection: "c-prod/analytics" });
  await m.settle();
  return m;
}

describe("the palette finds database objects", () => {
  it("contributes Database: find objects as a palette provider", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"));
    expect(manifest.contributes.paletteProviders).toEqual([
      { command: "endue.database.find-objects", title: "Database objects" },
    ]);
  });

  it("answers every kind of every database's cache with its connection, schema and kind, asking no server", async () => {
    const m = await cached();
    const before = runs(m);
    expect(await first(m, "orders")).toEqual({
      id: JSON.stringify(["c-prod", "table", "public", "", "orders"]),
      title: "orders",
      detail: "Table · public · Shop",
      kind: "table",
      actions: [
        {
          command: "endue.database.open-table",
          title: "Open the rows",
          args: { connection: "c-prod", schema: "public", table: "orders" },
        },
        {
          command: "endue.database.ddl",
          title: "Show the DDL",
          args: { connection: "c-prod", schema: "public", name: "orders", kind: "table" },
        },
        {
          command: "endue.database.copy-name",
          title: "Copy the qualified name",
          args: { text: '"public"."orders"' },
        },
      ],
    });
    // Another database of the server, under its reference.
    const visits = await find(m, "visits");
    expect(visits[0]).toMatchObject({
      title: "visits",
      detail: "Table · metrics · Shop/analytics",
    });
    expect(visits[0]?.actions[0]?.args).toEqual({
      connection: "c-prod/analytics",
      schema: "metrics",
      table: "visits",
    });
    // Its columns hold the query whole only in their qualified names, so they follow it.
    expect(visits.slice(1).map((r) => `${r.kind} ${r.title}`)).toEqual([
      "column id",
      "column page",
    ]);
    expect(await first(m, "big_orders")).toMatchObject({
      kind: "view",
      detail: "View · public · Shop",
    });
    expect(await first(m, "joined")).toMatchObject({
      kind: "column",
      detail: "Column of public.people · timestamp with time zone · Shop",
      actions: [
        { command: "endue.database.open-table", args: { table: "people" } },
        { command: "endue.database.copy-name", args: { text: '"public"."people"."joined"' } },
      ],
    });
    expect(await first(m, "refund")).toMatchObject({
      title: "refund(order_id integer)",
      kind: "procedure",
      actions: [
        {
          command: "endue.database.edit-source",
          args: { connection: "c-prod", schema: "public", name: "refund(order_id integer)" },
        },
        { command: "endue.database.ddl" },
        { args: { text: '"public"."refund"(order_id integer)' } },
      ],
    });
    expect(await first(m, "pair")).toMatchObject({ kind: "type", detail: "Type · public · Shop" });
    expect(await first(m, "sales")).toMatchObject({
      kind: "schema",
      detail: "Schema · Shop",
      actions: [{ command: "endue.database.console", args: { connection: "c-prod" } }, {}],
    });
    expect((await find(m, "metrics.vis")).map((r) => r.title)).toEqual(["visits", "id", "page"]);
    expect(await find(m, "or", 3)).toHaveLength(3);
    expect(await find(m, "qqqq")).toEqual([]);
    expect(await find(m, " ")).toEqual([]);
    // The SQLite connection has no cache; no name was asked of any server.
    expect(runs(m)).toBe(before);
  });

  it("answers from the plugin's store after a restart, before any cache is read", async () => {
    const m = await cached();
    const again = await mount({ store: { ...m.store }, script: () => ({ error: "no server" }) });
    expect(await first(again, "visits")).toMatchObject({
      detail: "Table · metrics · Shop/analytics",
    });
    expect(await first(again, "leads")).toMatchObject({ detail: "Table · sales · Shop" });
    expect(runs(again)).toBe(0);
  });

  it("runs what a result's actions name: the rows, the DDL, the name copied", async () => {
    const m = await cached();
    const orders = (await first(m, "visits")) as Result;
    const [open, ddl, copy] = orders.actions as [
      Result["actions"][0],
      Result["actions"][0],
      Result["actions"][0],
    ];
    await m.host.command(open.command, open.args);
    await m.settle();
    expect(m.shown()).toMatchObject({ kind: "table", connection: "c-prod/analytics" });
    const text = await m.host.command(ddl.command, ddl.args);
    expect(String(text)).toContain("CREATE TABLE");
    await m.host.command(copy.command, copy.args);
    expect(m.view.copied.at(-1)).toBe('"metrics"."visits"');
  });

  it("leaves out a connection hidden from the palette, on every database, until it is shown again", async () => {
    const m = await cached();
    expect(await m.host.command("endue.database.palette-hide", { connection: "Shop" })).toBe(true);
    expect(m.store["palette.hidden"]).toEqual(["c-prod"]);
    expect(await find(m, "orders")).toEqual([]);
    expect(await find(m, "visits")).toEqual([]);
    // Named by another database's reference, it is still the connection that is shown again.
    expect(
      await m.host.command("endue.database.palette-hide", { connection: "c-prod/analytics" }),
    ).toBe(false);
    expect(await first(m, "visits")).toMatchObject({ detail: "Table · metrics · Shop/analytics" });
    expect(m.store["palette.hidden"]).toEqual([]);
  });
});
