// The schema cache in the plugin (PG-06): the explorer and completion answer from it, the explorer
// says when it was read and reloads all of it, a DDL statement run from a console reads again what
// it touched, the plugin reloaded answers from its store, and the two commands.
import { describe, expect, it } from "vitest";
import type { Node } from "../ui/explorer.js";
import { indexKey } from "../ui/schema-cache/store.js";
import { type Mounted, mount, SAVED } from "./harness";
import { catalogScript, kindOf, type PgCatalog, schemasOf, shop } from "./pg-catalog";

const PASS = ["marks", "relations", "columns", "constraints", "indexes", "triggers", "routines"];

/** The SQL of every PostgreSQL run (a session each), in order. */
const ran = (m: Mounted) => m.sessions().map((sqls) => sqls[0] ?? "");
const row = (m: Mounted, label: string, kind?: string) =>
  m.view.trees.at(-1)?.find((r) => r.label === label && (!kind || r.kind === kind));
async function until(m: Mounted, test: () => unknown) {
  for (let i = 0; i < 60 && !test(); i++) await m.settle();
  expect(test()).toBeTruthy();
}
/** Open explorer rows by label, one after the other. */
async function open(m: Mounted, ...labels: string[]) {
  for (const label of labels) {
    await until(m, () => row(m, label));
    m.app.toggle(row(m, label) as Node, true);
    await m.settle();
  }
}

async function shopMounted(model: PgCatalog, more: Parameters<typeof mount>[0] = {}) {
  const m = await mount({
    store: { connections: SAVED },
    script: catalogScript(() => model, more.script),
    pick: () => "yes",
    ...(more.store ? { store: more.store } : {}),
  });
  return m;
}

describe("the schema cache in the plugin", () => {
  it("the explorer answers from the cache, shows when it was read and reloads all of it", async () => {
    const m = await shopMounted(shop());
    await open(m, "Shop", "public", "Tables", "people", "Columns");
    await until(m, () => row(m, "joined"));
    expect(row(m, "Shop")?.detail).toMatch(/^PostgreSQL · db\.example:5432 · read \d\d:\d\d$/u);
    expect(row(m, "joined")?.detail).toBe("timestamp with time zone = now()");
    expect(row(m, "Keys")?.detail).toBe("1");
    expect(row(m, "Triggers")?.detail).toBe("1");
    expect(row(m, "sales")?.detail).toBe("");
    expect(ran(m).map(kindOf)).toEqual(PASS);

    m.app.refresh("c-prod", row(m, "Shop"));
    await until(m, () => ran(m).length === 14 && row(m, "joined"));
    expect(ran(m).slice(7).map(kindOf)).toEqual(PASS);
    for (const sql of ran(m).slice(8)) expect(schemasOf(sql)).toEqual(["public", "sales"]);

    // g on a schema reads that schema.
    m.app.refresh("c-prod", row(m, "sales", "schema"));
    await until(m, () => ran(m).length === 21);
    for (const sql of ran(m).slice(15)) expect(schemasOf(sql)).toEqual(["sales"]);
  });

  it("a DDL statement run from a console refreshes what it touched", async () => {
    const model = shop();
    const people = model.public?.tables?.[0];
    const m = await shopMounted(model, {
      script: (sql) => {
        if (/^alter table/iu.test(sql)) {
          (model.public as { mark: string }).mark = "10.4:400";
          people?.columns?.push(["age", "integer"]);
          return { changes: 0 };
        }
        if (/^select \* from people/iu.test(sql)) return { rows: [["id"], ["ROW-SENTINEL"]] };
        return {};
      },
    });
    await open(m, "Shop");
    await until(m, () => ran(m).length === 7);
    await m.host.command("endue.database.console", { connection: "Shop" });
    m.view.text = "select * from people";
    await m.host.command("endue.database.run");
    m.view.text = "alter table public.people add column age integer";
    await m.host.command("endue.database.run");
    await until(m, () => ran(m).length === 16);
    const after = ran(m).slice(9);
    expect(after.map(kindOf)).toEqual(PASS);
    for (const sql of after.slice(1)) expect(schemasOf(sql)).toEqual(["public"]);
    await open(m, "public", "Tables", "people", "Columns");
    await until(m, () => row(m, "age"));
    const kept = JSON.stringify(
      Object.entries(m.store).filter(([k]) => k.startsWith("schema-cache")),
    );
    expect(kept).toContain("age");
    expect(kept).not.toContain("ROW-SENTINEL");
  });

  it("after a reload of the plugin the explorer and completion answer from the store", async () => {
    const model = shop();
    const first = await shopMounted(model);
    await open(first, "Shop");
    await until(first, () => ran(first).length === 7 && row(first, "public"));
    const m = await shopMounted(model, { store: { ...first.store } });
    await open(m, "Shop", "public", "Tables");
    await until(m, () => row(m, "people"));
    await m.host.command("endue.database.console", { connection: "Shop" });
    const tables = (await m.app.complete("select * from ", 14)) as { items: { label: string }[] };
    expect(tables.items.map((i) => i.label)).toEqual(
      expect.arrayContaining(["big_orders", "orders", "people", "sales"]),
    );
    const columns = (await m.app.complete("select  from people", 7)) as {
      items: { label: string; kind: string }[];
    };
    expect(columns.items.filter((i) => i.kind === "column").map((i) => i.label)).toEqual([
      "id",
      "joined",
      "name",
    ]);
    await m.settle();
    expect(ran(m).map(kindOf)).toEqual(["marks"]);
  });

  it("Database: choose the schemas to read and Database: read the schema again", async () => {
    const model: PgCatalog = { ...shop(), pg_toast: { mark: "5", system: true } };
    let picked = "pg_catalog";
    const m = await mount({
      store: { connections: SAVED },
      script: catalogScript(() => model),
      pick: () => picked,
    });
    await m.host.command("endue.database.reload-schema", { connection: "Shop" });
    expect(ran(m).map(kindOf)).toEqual(PASS);
    expect(m.view.said.at(-1)).toBe("Read 2 schemas of Shop in 7 statements.");

    await m.host.command("endue.database.choose-schemas", { connection: "Shop", schema: "sales" });
    expect(m.store[indexKey("c-prod")]).toMatchObject({ chosen: ["public"] });
    expect(ran(m)).toHaveLength(8);
    await open(m, "Shop");
    await until(m, () => row(m, "sales"));
    expect(row(m, "sales")?.detail).toBe("not cached");
    expect(row(m, "pg_catalog")).toBeUndefined();

    await m.host.command("endue.database.choose-schemas", { connection: "Shop" });
    const items = m.picks.at(-1)?.items.map((i) => i.label);
    expect(items).toEqual([
      "Every schema but the system ones",
      "information_schema",
      "pg_catalog",
      "pg_toast",
      "✓ public",
      "sales",
    ]);
    expect(ran(m).slice(-6).map(schemasOf)).toEqual(Array(6).fill(["pg_catalog"]));
    await until(m, () => row(m, "pg_catalog"));

    picked = "\u0000default";
    await m.host.command("endue.database.choose-schemas", { connection: "Shop" });
    expect(m.store[indexKey("c-prod")]).toMatchObject({ chosen: null });

    await m.host.command("endue.database.choose-schemas", { connection: "Notes" }).catch(() => {});
    expect(m.view.said.at(-1)).toMatch(/Notes is not cached/u);
  });
});
