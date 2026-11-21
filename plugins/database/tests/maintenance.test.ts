// The maintenance form through the plugin's commands and actions on the SDK's test host, against
// the scripted PostgreSQL of maintenance-fixture.ts: opened from the explorer's rows and the
// palette, and what is refused (another engine, a standby, a server older than 13).
import { describe, expect, it } from "vitest";
import { actionFor } from "../ui/keys.js";
import { acts, node, ORDERS, start } from "./maintenance-host";

describe("opening the form", () => {
  it("opens the form from the explorer's table, index, schema and connection rows and from the palette", async () => {
    const { m } = await start({
      pick: ({ title }) =>
        ({
          "Database: maintenance on which connection?": "c-warehouse",
          "Database: maintenance of what?": "public",
          "Database: maintenance of what in public?": "stock",
        })[title] ?? "",
    });
    expect(actionFor("explorer", { key: "m", mod: false, shift: false, alt: false })).toBe(
      "maintain",
    );
    await acts(m).maintain?.(ORDERS);
    expect(m.shown()).toMatchObject({
      kind: "maintenance",
      name: "maintenance: warehouse · public.orders",
    });
    const table = m.shown()?.maintenance;
    expect(table).toMatchObject({ operation: "vacuum", reading: false, error: "", run: null });
    expect(table.read).toMatchObject({
      server: "17.6",
      database: "warehouse",
      recovery: false,
      relkind: "r",
    });
    expect(table.read.stats).toMatchObject({
      live: 120000,
      dead: 30000,
      total: 16777216,
      lastVacuum: null,
    });
    expect(table.options.using).toBe("orders_pkey");
    expect(m.view.said.at(-1)).toBe(
      "public.orders on warehouse: 16 MB in all (table 12 MB, indexes 4 MB) · 120,000 rows, 30,000 dead.",
    );
    const part = {
      schema: "public",
      table: "orders",
      kind: "index",
      name: "orders_customer_idx",
      detail: "",
      extra: "",
    } as const;
    await acts(m).maintain?.(
      node({ kind: "part", schema: "public", table: "orders", part, label: part.name }),
    );
    expect(m.shown()?.maintenance).toMatchObject({
      target: { kind: "index", schema: "public", table: "orders", index: "orders_customer_idx" },
      operation: "reindex",
    });
    expect(m.shown()?.maintenance.read.stats.index).toBe(1048576);
    await acts(m).maintain?.(node({ kind: "schema", schema: "public", label: "public" }));
    expect(m.shown()?.maintenance.read.tables).toEqual(["daily_totals", "orders", "stock"]);
    await acts(m).maintain?.(node({ kind: "connection", label: "warehouse" }));
    expect(m.shown()?.name).toBe("maintenance: warehouse · database warehouse");
    // A view is not a table.
    const view = node({
      kind: "table",
      schema: "public",
      table: "recent",
      label: "recent",
      object: {
        schema: "public",
        name: "recent",
        kind: "view",
        detail: "",
        rows: null,
        ident: "3",
      },
    });
    await acts(m).maintain?.(view);
    expect(m.view.said.at(-1)).toBe(
      "recent is a view: maintenance runs on tables and materialized views.",
    );
    // The palette: a connection, then what in it.
    await m.host.command("endue.database.console", { connection: "Notes" });
    await m.host.command("endue.database.maintenance");
    expect(m.picks.map((p) => p.title).slice(0, 3)).toEqual([
      "Database: maintenance on which connection?",
      "Database: maintenance of what?",
      "Database: maintenance of what in public?",
    ]);
    expect(m.picks[2]?.items.map((i) => i.id)).toEqual([
      "\u0000",
      "daily_totals",
      "orders",
      "stock",
    ]);
    expect(m.shown()?.name).toBe("maintenance: warehouse · public.stock");
    // An agent (or the server overview) names it all, and is answered what the form shows.
    const answer = (await m.host.command("endue.database.maintenance", {
      connection: "warehouse",
      schema: "public",
      table: "orders",
      operation: "cluster",
      options: { verbose: false, using: "orders_customer_idx" },
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({
      target: "public.orders",
      operation: "CLUSTER",
      statement: "CLUSTER public.orders USING orders_customer_idx",
      blocksReadsOrWrites: true,
    });
    expect(answer.locks).toContain(
      "While it waits for its lock, sessions that come after it wait too.",
    );
    await expect(
      m.host.command("endue.database.maintenance", {
        connection: "warehouse",
        schema: "public",
        table: "orders",
        options: { using: "orders_note_trgm" },
      }),
    ).rejects.toThrow("orders_note_trgm is not an index CLUSTER can order this table by.");
  });
});

describe("what is refused", () => {
  it("refuses a connection that is not PostgreSQL and a standby", async () => {
    const { m } = await start();
    await acts(m).maintain?.(node({ kind: "connection", connection: "c-lite", label: "Notes" }));
    expect(m.view.said.at(-1)).toBe(
      "Notes is SQLite: VACUUM, ANALYZE, REINDEX and CLUSTER run from here on PostgreSQL connections.",
    );
    await expect(
      m.host.command("endue.database.maintenance", { connection: "Notes" }),
    ).rejects.toThrow("Notes is SQLite: VACUUM");
    await expect(m.host.command("endue.database.maintenance-run")).rejects.toThrow(
      "No maintenance form on screen: open one with Database: maintenance.",
    );
    const standby = (await start({ recovery: true })).m;
    await standby.host.command("endue.database.maintenance", {
      connection: "warehouse",
      schema: "public",
      table: "orders",
    });
    await expect(standby.host.command("endue.database.maintenance-run")).rejects.toThrow(
      "warehouse is a standby (in recovery): maintenance runs on the primary.",
    );
    const old = (await start({ version: 120022 })).m;
    await expect(
      old.host.command("endue.database.maintenance", {
        connection: "warehouse",
        schema: "public",
        table: "orders",
      }),
    ).rejects.toThrow(
      "warehouse runs PostgreSQL 12.22: maintenance from this form needs PostgreSQL 13 or later.",
    );
  });
});
