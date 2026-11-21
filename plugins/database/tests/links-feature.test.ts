// Following foreign keys through the plugin (PG-41, #468), on the SDK's test host with the links
// catalog's scripted server (links-fixture.ts): a key followed to the referenced row in a table view
// filtered by quick filters and back again, a key of two columns and one that points at its own
// table, the rows that point at a row counted on request and opened, the referenced table searched
// in pages when a key cell is edited, keys read from pg_constraint when the cache does not hold the
// table, and what is said when nothing can be followed. The grid is a stand-in: `view.cell`.
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import { FIXTURE_CONNECTION, fixtureScript } from "./fixtures";
import { FIXTURE_PG_CONNECTION } from "./fixtures-pg";
import { type Mounted, mount } from "./harness";
import { LINKS_ROWS, linksCatalog, linksServer, pagesOf } from "./links-fixture";
import { catalogScript } from "./pg-catalog";

const CONN: Connection = { ...FIXTURE_PG_CONNECTION, id: "c-links", name: "links" };
type Pick = Parameters<typeof mount>[0] extends infer O ? NonNullable<O>["pick"] : never;

async function links(
  options: { pick?: Pick; seen?: string[]; script?: Parameters<typeof mount>[0]["script"] } = {},
) {
  const seen = options.seen ?? [];
  return mount({
    store: { connections: [CONN] },
    script: options.script ?? linksServer(seen),
    ...(options.pick ? { pick: options.pick } : {}),
  });
}

const open = async (m: Mounted, table: string, schema = "public") => {
  await m.host.command("endue.database.open-table", { connection: CONN.id, schema, table });
  await m.settle();
};
/** The grid's cursor on a result cell, as the real grid answers it. */
const cursor = (m: Mounted, row: number, col: number) => {
  m.view.cell = () => {
    const set = m.shown()?.shown?.tabs[0]?.set;
    return {
      row,
      col,
      value: set?.rows[row]?.[col] ?? null,
      name: set?.columns[col] ?? "",
      type: "",
      editable: true,
      reason: "",
    } as never;
  };
};
const rows = (m: Mounted) => m.shown()?.shown?.tabs[0]?.set?.rows;
const pages = (seen: string[], table: string) =>
  seen.filter((sql) => sql.startsWith(`SELECT * FROM "public"."${table}"`));

describe("following foreign keys through the plugin", () => {
  it("follows a key to the referenced row in a table view filtered by quick filters, and back returns", async () => {
    const seen: string[] = [];
    const m = await links({ seen });
    await open(m, "orders");
    await m.app.page?.({
      filters: [{ key: "total", name: "total", op: "gt", value: "10", numeric: true }],
    });
    await m.settle();
    expect(rows(m)).toHaveLength(2);
    cursor(m, 0, 1);
    const said = await m.host.command("endue.database.follow-key");
    await m.settle();
    expect(said).toBe("public.people where id = 1: b goes back.");
    expect(m.shown()?.table).toMatchObject({
      schema: "public",
      name: "people",
      where: "",
      filters: [{ key: "id", name: "id", op: "eq", value: "1", numeric: true }],
    });
    expect(rows(m)).toEqual([["1", "Ada"]]);
    // The new view is read filtered at once: no page of every person first.
    expect(pages(seen, "people")).toEqual([
      'SELECT * FROM "public"."people" WHERE "id" = 1 LIMIT 500 OFFSET 0',
    ]);
    expect(await m.host.command("endue.database.go-back")).toBe("Back to public.orders.");
    await m.settle();
    expect(m.shown()?.table?.name).toBe("orders");
    expect(m.shown()?.table?.filters?.map((f) => f.value)).toEqual(["10"]);
    expect(rows(m)).toHaveLength(2);
  });

  it("follows a key of two columns, and one that points at its own table", async () => {
    const m = await links();
    await open(m, "notes");
    cursor(m, 0, 2);
    expect(await m.host.command("endue.database.follow-key")).toBe(
      "public.lines where order_id = 1 and line = 2: b goes back.",
    );
    await m.settle();
    expect(rows(m)).toEqual([["1", "2", "ink"]]);

    await open(m, "staff");
    cursor(m, 2, 2);
    await m.host.command("endue.database.follow-key");
    await m.settle();
    expect(rows(m)).toEqual([["2", "Bob", "1"]]);
    cursor(m, 0, 2);
    await m.host.command("endue.database.follow-key");
    await m.settle();
    expect(rows(m)).toEqual([["1", "Ada", null]]);
    // Back restores the same view's filters one step at a time.
    expect(await m.host.command("endue.database.go-back")).toBe("Back to public.staff.");
    await m.settle();
    expect(m.shown()?.table?.filters?.map((f) => f.value)).toEqual(["2"]);
    expect(rows(m)).toEqual([["2", "Bob", "1"]]);
    await m.host.command("endue.database.go-back");
    await m.settle();
    expect(m.shown()?.table?.filters).toEqual([]);
    expect(rows(m)).toHaveLength(3);
    expect(await m.host.command("endue.database.go-back")).toBe("Back to public.notes.");
  });

  it("lists the rows that point at this row, counts them on request and opens one filtered", async () => {
    let round = 0;
    const m = await links({
      pick: ({ items }) => {
        round++;
        if (round === 1) return items.find((i) => i.label === "Count the rows of each")?.id ?? "";
        return items.find((i) => i.label.startsWith("public.orders"))?.id ?? "";
      },
    });
    await open(m, "people");
    cursor(m, 0, 0);
    expect(await m.host.command("endue.database.referencing-rows")).toBe(
      "public.orders where person = 1: b goes back.",
    );
    await m.settle();
    const [first, second] = m.picks as Array<{
      title: string;
      items: Array<{ id: string; label: string; detail?: string }>;
    }>;
    expect(first?.title).toBe("Database: open the rows that point at this row");
    expect(first?.items.map((i) => i.label)).toEqual([
      "Count the rows of each",
      "archive.old_orders (person)",
      "public.orders (person)",
    ]);
    expect(second?.items.map((i) => i.detail)).toEqual(["1 row", "2 rows"]);
    expect(rows(m)).toEqual([
      ["1", "1", "12.00"],
      ["3", "1", "7.50"],
    ]);
    // An agent names the key, and nothing is asked.
    await open(m, "people");
    cursor(m, 0, 0);
    await m.host.command("endue.database.referencing-rows", {
      constraint: "old_orders_person_fkey",
    });
    await m.settle();
    expect(m.shown()?.table).toMatchObject({ schema: "archive", name: "old_orders" });
    expect(rows(m)).toEqual([["9", "1"]]);
    expect(m.picks).toHaveLength(2);
  });

  it("searches the referenced table in pages when a key cell is edited, and sets every column of the key as one pending step", async () => {
    const seen: string[] = [];
    let round = 0;
    const m = await links({
      seen,
      pick: ({ items }) => {
        round++;
        if (round === 1) return items.find((i) => i.label.startsWith("More rows"))?.id ?? "";
        if (round === 2) return "bo";
        return items.find((i) => i.label === "2 · Bob")?.id ?? "";
      },
    });
    await open(m, "orders");
    cursor(m, 0, 1);
    expect(await m.host.command("endue.database.pick-key")).toBe(
      "person = 2 (Bob): pending until Submit.",
    );
    const asked = m.picks as Array<{ title: string; items: Array<{ id: string; label: string }> }>;
    expect(asked[0]?.title).toBe("Database: person is which row of public.people?");
    expect(asked[0]?.items).toHaveLength(51);
    expect(asked[0]?.items.slice(0, 2).map((i) => i.label)).toEqual(["1 · Ada", "2 · Bob"]);
    expect(asked[1]?.items.map((i) => i.label)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `${51 + i} · P${51 + i}`),
    ]);
    expect(asked[2]?.title).toBe("Database: person is which row of public.people? Holding “bo”");
    expect(asked[2]?.items.map((i) => i.label)).toEqual(["2 · Bob", "Use “bo” as it is"]);
    expect(seen.filter((sql) => sql.startsWith('SELECT "id", "name" FROM'))).toEqual([
      'SELECT "id", "name" FROM "public"."people" ORDER BY "id" LIMIT 51 OFFSET 0',
      'SELECT "id", "name" FROM "public"."people" ORDER BY "id" LIMIT 51 OFFSET 50',
      `SELECT "id", "name" FROM "public"."people" WHERE CAST("id" AS text) ILIKE '%bo%' ESCAPE '!' OR CAST("name" AS text) ILIKE '%bo%' ESCAPE '!' ORDER BY "id" LIMIT 51 OFFSET 0`,
    ]);
    expect(m.shown()?.edit?.changes.updates.get(0)?.get(1)).toBe("2");

    round = 10;
    const composite = await links({
      pick: ({ items }) => items.find((i) => i.label === "1 · 2 · ink")?.id ?? "",
    });
    await open(composite, "notes");
    cursor(composite, 1, 1);
    expect(await composite.host.command("endue.database.pick-key")).toBe(
      "order_id, line = 1, 2 (ink): pending until Submit.",
    );
    const update = composite.shown()?.edit?.changes.updates.get(1);
    expect([update?.get(1), update?.get(2)]).toEqual(["1", "2"]);
    expect(await composite.host.command("endue.database.undo-change")).toBe(
      "Took back the last pending change.",
    );
    expect(composite.shown()?.edit?.count).toBe(0);
  });

  it("reads the keys from the catalog's constraints when the cache does not hold the table", async () => {
    const seen: string[] = [];
    const pagesOfAll = pagesOf({
      ...LINKS_ROWS,
      "public.made_since": [
        ["id", "person"],
        ["1", "3"],
      ],
    });
    const script = catalogScript(linksCatalog, (sql) => {
      seen.push(sql);
      if (sql.startsWith("SELECT k.conname,"))
        return {
          rows: [
            ["conname", "nspname", "relname", "cols", "nspname", "relname", "refs"],
            [
              "made_since_person_fkey",
              "public",
              "made_since",
              '["person"]',
              "public",
              "people",
              '["id"]',
            ],
          ],
        };
      return pagesOfAll(sql) ?? {};
    });
    const m = await links({ script });
    await open(m, "made_since");
    cursor(m, 0, 1);
    expect(await m.host.command("endue.database.follow-key")).toBe(
      "public.people where id = 3: b goes back.",
    );
    await m.settle();
    expect(rows(m)).toEqual([["3", "Cy"]]);
    expect(
      seen.some(
        (sql) => sql.startsWith("SELECT k.conname,") && sql.includes("c.relname = 'made_since'"),
      ),
    ).toBe(true);
  });

  it("says why nothing is followed: no key on the column, a NULL key, another engine, nothing to go back to", async () => {
    const m = await links();
    await expect(m.host.command("endue.database.go-back")).rejects.toThrow(
      "Nothing to go back to: follow a key first (g in the grid).",
    );
    await open(m, "orders");
    m.view.cell = () => undefined;
    await expect(m.host.command("endue.database.follow-key")).rejects.toThrow(
      "Put the grid's cursor on a cell first.",
    );
    cursor(m, 0, 2);
    await expect(m.host.command("endue.database.follow-key")).rejects.toThrow(
      "total is in no foreign key of public.orders: there is nothing to follow.",
    );
    await open(m, "staff");
    cursor(m, 0, 2);
    await expect(m.host.command("endue.database.follow-key")).rejects.toThrow(
      "boss is NULL: the key points at no row.",
    );
    const lite = await mount({
      store: { connections: [FIXTURE_CONNECTION] },
      script: fixtureScript,
    });
    await lite.host.command("endue.database.open-table", {
      connection: FIXTURE_CONNECTION.id,
      schema: "main",
      table: "orders",
    });
    await lite.settle();
    cursor(lite, 0, 1);
    await expect(lite.host.command("endue.database.follow-key")).rejects.toThrow(
      "Following foreign keys is for PostgreSQL connections.",
    );
    // The grid's own reading of the links answers nothing there, and says nothing.
    expect(await lite.app.linksLoad?.()).toBeUndefined();
    expect(lite.view.said.at(-1)).toBe("Following foreign keys is for PostgreSQL connections.");
  });

  it("answers the grid which columns of the result on screen link, and whether rows point at it", async () => {
    const m = await links();
    await open(m, "orders");
    expect(await m.app.linksLoad?.()).toEqual({
      columns: [{ col: 1, title: "Points at public.people (id): g or Mod+click opens that row" }],
      referenced: true,
    });
    await open(m, "people");
    expect(await m.app.linksLoad?.()).toEqual({ columns: [], referenced: true });
  });
});
