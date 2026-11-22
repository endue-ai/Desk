// PG-50 in the plugin: the explorer shows a PostgreSQL connection's other kinds from its schema
// cache (folders under a schema and a table, the connection's Database and Server rows), `d` on
// each opens its DDL without a statement past the pass, and completion offers the schema's types.
import { describe, expect, it } from "vitest";
import type { Node } from "../ui/explorer.js";
import { type Mounted, mount, SAVED } from "./harness";
import { catalogScript, shop } from "./pg-catalog";

/** How many PostgreSQL runs there were (a session each). */
const runs = (m: Mounted) => m.sessions().length;
const tree = (m: Mounted) => m.view.trees.at(-1) ?? [];
const row = (m: Mounted, label: string, under?: Node) =>
  tree(m).find((r) => r.label === label && (!under || r.key.startsWith(`${under.key}\u0000`)));
const children = (m: Mounted, node: Node | undefined) =>
  tree(m)
    .filter((r) => node && r.key.startsWith(`${node.key}\u0000`) && r.level === node.level + 1)
    .map((r) => (r.detail ? `${r.label} · ${r.detail}` : r.label));
async function until(m: Mounted, test: () => unknown) {
  for (let i = 0; i < 60 && !test(); i++) await m.settle();
  expect(test()).toBeTruthy();
}
/** Open rows by label, each under the one before. */
async function open(m: Mounted, ...labels: string[]) {
  let at: Node | undefined;
  for (const label of labels) {
    await until(m, () => row(m, label, at));
    at = row(m, label, at) as Node;
    m.app.toggle(at, true);
    await m.settle();
  }
  return row(m, labels.at(-1) ?? "", undefined) && (tree(m).find((r) => r.key === at?.key) as Node);
}
const ddlOf = async (m: Mounted, node: Node | undefined) => {
  await m.app.ddl(node as Node);
  await m.settle();
  return m.view.consoles.at(-1)?.model as { name?: string; text?: string } | undefined;
};

describe("PG-50's kinds in the explorer", () => {
  it("the explorer shows the new folders", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: catalogScript(() => shop()),
      pick: () => "yes",
    });
    const shopRow = await open(m, "Shop");
    await until(m, () => row(m, "Server", shopRow));
    const passed = runs(m);
    expect(passed).toBeGreaterThan(0);
    // PG-13: under the connection's own database, the first of its server's and open.
    expect(children(m, shopRow)).toEqual(["shop · the connection's"]);
    const own = row(m, "shop", shopRow) as Node;
    expect(children(m, own)).toEqual(["public", "sales", "Database · shop", "Server"]);

    // Under a schema, after PG-06's folders.
    const pub = await open(m, "Shop", "public");
    expect(children(m, pub)).toEqual([
      "Tables · 4",
      "Views · 1",
      "Sequences · 1",
      "Routines · 2",
      "Types · 5",
      "Aggregates · 1",
      "Operators · 1",
      "Collations · 1",
      "Text search · 1",
    ]);
    const types = await open(m, "Shop", "public", "Types");
    expect(children(m, types)).toEqual([
      "four · base",
      "mood · enum",
      "pair · composite",
      "positive · domain of numeric(10,2)",
      "span · range of integer",
    ]);
    const mood = await ddlOf(m, row(m, "mood", types));
    expect(mood?.text).toMatch(/^-- Owner: app\nCREATE TYPE "public"."mood" AS ENUM/u);

    // Under a table: its partitions with their bounds, what it inherits, its policies and rules.
    const tables = await open(m, "Shop", "public", "Tables");
    expect(row(m, "people", tables)?.detail).toBe("RLS on · ~4 rows · ~48 KiB");
    const events = await open(m, "Shop", "public", "Tables", "events");
    const partitions = await open(m, "Shop", "public", "Tables", "events", "Partitions");
    expect(row(m, "Partitions", events)?.detail).toBe("3");
    expect(children(m, partitions)).toEqual([
      "events_2026 · FOR VALUES FROM ('2026-01-01') TO ('2027-01-01') · partitioned",
      "events_2026_one · FOR VALUES IN (1) · of events_2026",
      "events_rest · DEFAULT",
    ]);
    const people = await open(m, "Shop", "public", "Tables", "people");
    expect(children(m, people).filter((r) => /^(Policies|Rules)/u.test(r))).toEqual([
      "Policies · 1",
      "Rules · 1",
    ]);
    await open(m, "Shop", "public", "Tables", "people", "Policies");
    const archive = await open(m, "Shop", "public", "Tables", "people_archive", "Inherits");
    expect(children(m, archive)).toEqual(["people · public.people"]);
    const policy = await ddlOf(m, row(m, "own_rows", people));
    expect(policy).toMatchObject({ name: "ddl: Shop · people.own_rows" });
    expect(policy?.text).toMatch(/^CREATE POLICY "own_rows" ON "public"."people"/u);

    // Under the connection: the database's own objects and the server's.
    const database = await open(m, "Shop", "Database");
    expect(children(m, database)).toEqual([
      "Extensions · 1",
      "Foreign data wrappers · 1",
      "Foreign servers · 1",
      "User mappings · 1",
      "Publications · 1",
      "Subscriptions · 1",
      "Event triggers · 1",
      "Casts · 1",
      "Languages · 1",
    ]);
    const extensions = await open(m, "Shop", "Database", "Extensions");
    expect(children(m, extensions)).toEqual(["plpgsql · 1.0 · 2 objects"]);
    const plpgsql = await ddlOf(m, row(m, "plpgsql", extensions));
    expect(plpgsql).toMatchObject({ name: "ddl: Shop · plpgsql" });
    expect(plpgsql?.text).toMatch(/CREATE EXTENSION IF NOT EXISTS "plpgsql"/u);
    const server = await open(m, "Shop", "Server");
    expect(children(m, server)).toEqual(["Roles · 2", "Tablespaces · 1"]);
    const roles = await open(m, "Shop", "Server", "Roles");
    expect(children(m, roles)).toEqual(["app · login", "reader"]);
    expect((await ddlOf(m, row(m, "app", roles)))?.text).toMatch(/^CREATE ROLE "app" WITH/u);
    expect(runs(m)).toBe(passed);

    // A filter keeps the matching objects of these rows too.
    m.app.filter?.("shop");
    await m.settle();
    expect(children(m, row(m, "Database", shopRow) as Node)).toEqual([
      "Publications · 1 of 1",
      "Subscriptions · 1 of 1",
    ]);
  });

  it("completion offers the schema's types", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: catalogScript(() => shop()),
      pick: () => "yes",
    });
    await open(m, "Shop");
    await until(m, () => row(m, "Server"));
    await m.host.command("endue.database.console", { connection: "Shop" });
    const cast = (await m.app.complete("select '1'::", 12)) as {
      items: { label: string; kind: string; detail: string }[];
    };
    expect(
      cast.items.filter((i) => i.kind === "type").map((i) => `${i.label} ${i.detail}`),
    ).toEqual([
      "four base · public",
      "mood enum · public",
      "pair composite · public",
      "positive domain of numeric(10,2) · public",
      "span range of integer · public",
    ]);
    const qualified = (await m.app.complete("select '1'::public.", 19)) as {
      items: { label: string; kind: string }[];
    };
    expect(qualified.items.filter((i) => i.kind === "type")).toHaveLength(5);
  });
});
