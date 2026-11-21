// A table view's quick filters and sort keys on the server (ui/grid/filters.js, ui/pages.js): each
// filter as SQL in each dialect, joined to the filter the person typed, the keys as ORDER BY, and the
// columns a table view keeps in the plugin's store (ui/features/grid/).
import { describe, expect, it } from "vitest";
import { filterSql, orderSql, whereWith } from "../ui/grid/filters.js";
import { mount, SAVED, type Spawned } from "./harness";

type Op = "eq" | "ne" | "gt" | "lt" | "contains" | "empty" | "null" | "notNull";
const filter = (name: string, op: Op, value = "", numeric = false) => ({
  key: name,
  name,
  op,
  value,
  numeric,
});
const sqliteRuns = (spawned: Spawned[]) => spawned.filter((s) => s.command === "sqlite3");
const lastSql = (spawned: Spawned[]) =>
  (sqliteRuns(spawned).at(-1)?.args ?? []).find((a) => /^SELECT /u.test(a)) ?? "";

describe("quick filters as SQL", () => {
  it("writes each quick filter as SQL in each dialect", () => {
    expect(filterSql("postgresql", filter("name", "eq", "O'Neil"))).toBe(`"name" = 'O''Neil'`);
    expect(filterSql("postgresql", filter("total", "gt", "12", true))).toBe(`"total" > 12`);
    expect(filterSql("postgresql", filter("total", "lt", "-1.5", true))).toBe(`"total" < -1.5`);
    expect(filterSql("postgresql", filter("total", "gt", "1; drop", true))).toBe(
      `"total" > '1; drop'`,
    );
    expect(filterSql("mysql", filter("name", "ne", "a\\b"))).toBe("`name` <> 'a\\\\b'");
    expect(filterSql("postgresql", filter("note", "contains", "50%_a!"))).toBe(
      `CAST("note" AS text) ILIKE '%50!%!_a!!%' ESCAPE '!'`,
    );
    expect(filterSql("mysql", filter("note", "contains", "50%_a!"))).toBe(
      "CAST(`note` AS CHAR) LIKE '%50!%!_a!!%' ESCAPE '!'",
    );
    expect(filterSql("sqlite", filter("note", "contains", "50%_a!"))).toBe(
      `"note" LIKE '%50!%!_a!!%' ESCAPE '!'`,
    );
    expect(filterSql("sqlite", filter("note", "empty"))).toBe(`"note" = ''`);
    expect(filterSql("sqlite", filter("note", "null"))).toBe(`"note" IS NULL`);
    expect(filterSql("sqlite", filter("note", "notNull"))).toBe(`"note" IS NOT NULL`);
    expect(
      whereWith("sqlite", "a = 1 or b = 2", [filter("x", "eq", "y"), filter("n", "null")]),
    ).toBe(`(a = 1 or b = 2) AND "x" = 'y' AND "n" IS NULL`);
    expect(whereWith("sqlite", " ", [filter("x", "eq", "y")])).toBe(`"x" = 'y'`);
    expect(whereWith("sqlite", "a = 1", [])).toBe("a = 1");
    expect(
      orderSql("mysql", [
        { key: "total", name: "total", direction: "desc" },
        { key: "name", name: "name", direction: "asc" },
      ]),
    ).toBe("`total` DESC, `name` ASC");
  });
});

describe("a table view on the server", () => {
  it("a table view's quick filters are its WHERE after the typed one, and its sort keys its ORDER BY", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: () => ({
        rows: [
          ["id", "name"],
          ["1", "Bob"],
        ],
      }),
    });
    await m.host.command("endue.database.open-table", {
      connection: "Notes",
      schema: "main",
      table: "notes",
    });
    await m.settle();
    m.app.page({ filters: [filter("name", "eq", "Bob")] });
    await m.settle();
    expect(lastSql(m.clients.spawned)).toBe(
      `SELECT * FROM "notes" WHERE "name" = 'Bob' LIMIT 500 OFFSET 0`,
    );
    m.app.page({ where: "id > 1", order: "" });
    await m.settle();
    expect(lastSql(m.clients.spawned)).toBe(
      `SELECT * FROM "notes" WHERE (id > 1) AND "name" = 'Bob' LIMIT 500 OFFSET 0`,
    );
    const keys = [
      { key: "id", name: "id", direction: "desc" as const },
      { key: "name", name: "name", direction: "asc" as const },
    ];
    m.app.page({ sort: keys });
    await m.settle();
    expect(lastSql(m.clients.spawned)).toBe(
      `SELECT * FROM "notes" WHERE (id > 1) AND "name" = 'Bob' ORDER BY "id" DESC, "name" ASC LIMIT 500 OFFSET 0`,
    );
    expect(m.shown()?.table).toMatchObject({
      where: "id > 1",
      order: `"id" DESC, "name" ASC`,
      sort: keys,
      filters: [filter("name", "eq", "Bob")],
    });
    // Apply with the order the grid wrote keeps its keys; another typed order drops them.
    m.app.page({ where: "id > 1", order: `"id" DESC, "name" ASC` });
    await m.settle();
    expect(m.shown()?.table?.sort).toEqual(keys);
    m.app.page({ count: true });
    await m.settle();
    expect(lastSql(m.clients.spawned)).toBe(
      `SELECT count(*) FROM "notes" WHERE (id > 1) AND "name" = 'Bob'`,
    );
    m.app.page({ where: "id > 1", order: "id" });
    await m.settle();
    expect(m.shown()?.table?.sort).toEqual([]);
    m.app.page({ filters: [] });
    await m.settle();
    expect(lastSql(m.clients.spawned)).toBe(
      `SELECT * FROM "notes" WHERE id > 1 ORDER BY id LIMIT 500 OFFSET 0`,
    );
  });

  it("keeps a table view's columns in the store, per table, and reads them back after a restart", async () => {
    const app = (m: Awaited<ReturnType<typeof mount>>) =>
      m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const first = await mount({ store: { connections: SAVED } });
    const state = { order: ["name", "id"], hidden: ["note"], pinned: ["name"], widths: { id: 90 } };
    await app(first).columnsKeep?.("table:c-lite:main.notes", state);
    expect(first.store["grid:c-lite:main.notes"]).toEqual({ v: 1, ...state });
    const again = await mount({ store: { ...first.store } });
    expect(await app(again).columnsLoad?.("table:c-lite:main.notes")).toEqual(state);
    expect(await app(again).columnsLoad?.("table:c-lite:main.other")).toBeUndefined();
    // A console's result is never kept.
    await app(again).columnsKeep?.("result:c-lite:1:0", state);
    expect(Object.keys(again.store).filter((k) => k.startsWith("grid:"))).toEqual([
      "grid:c-lite:main.notes",
    ]);
  });
});
