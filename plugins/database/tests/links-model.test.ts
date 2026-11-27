// Following foreign keys, the model (PG-41, #468): which result columns link and where to, the
// quick filters a row's key values make (several columns too, a NULL refused), the keys pointing at a
// table from every schema the cache holds, the search of a referenced table, its readable column,
// the keys read from pg_constraint's rows, and the trail back. Pure; fixture data only.
import { describe, expect, it } from "vitest";
import {
  createTrail,
  keyFilters,
  keysOfCache,
  keysOfRows,
  keysSql,
  linkColumns,
  linkTitle,
  readableColumn,
  searchSql,
} from "../ui/links/model.js";
import { linksCatalog } from "./links-fixture";
import { cacheOver, PG } from "./schema-cache-helpers";

const key = (name: string, from: [string, string, string[]], to: [string, string, string[]]) => ({
  name,
  from: { schema: from[0], table: from[1], columns: from[2] },
  to: { schema: to[0], table: to[1], columns: to[2] },
});
const PERSON = key(
  "orders_person_fkey",
  ["public", "orders", ["person"]],
  ["public", "people", ["id"]],
);
const LINE = key(
  "notes_line_fkey",
  ["public", "notes", ["order_id", "line"]],
  ["public", "lines", ["order_id", "line"]],
);

describe("following foreign keys: the model", () => {
  it("links the result columns of each declared key whose columns are all in the result", () => {
    const columns = ["id", "order_id", "line", "body"];
    const links = linkColumns([LINE], columns);
    expect([...links.keys()]).toEqual([1, 2]);
    expect(links.get(1)).toEqual([LINE]);
    // A key with a column the result lacks links nothing; a column of no key is plain.
    expect([...linkColumns([LINE], ["id", "order_id", "body"]).keys()]).toEqual([]);
    expect([...linkColumns([PERSON], ["id", "person", "total"]).keys()]).toEqual([1]);
    expect(linkTitle([LINE])).toBe(
      "Points at public.lines (order_id, line): g or Mod+click opens that row",
    );
    const other = key("x_fkey", ["public", "orders", ["person"]], ["archive", "folk", ["code"]]);
    expect(linkTitle([PERSON, other])).toBe(
      "Points at public.people (id) and archive.folk (code): g or Mod+click opens one",
    );
  });

  it("turns a row's key values into the referenced table's quick filters", () => {
    const columns = ["id", "order_id", "line", "body"];
    const numeric = [true, true, true, false];
    expect(
      keyFilters({
        from: LINE.from.columns,
        onto: LINE.to.columns,
        columns,
        row: ["1", "1", "2", "Blue ink"],
        numeric,
      }),
    ).toEqual({
      filters: [
        { key: "order_id", name: "order_id", op: "eq", value: "1", numeric: true },
        { key: "line", name: "line", op: "eq", value: "2", numeric: true },
      ],
    });
    // A text key is compared as a literal, quotes and all.
    expect(
      keyFilters({
        from: ["code"],
        onto: ["code"],
        columns: ["code"],
        row: ["O'Brien"],
        numeric: [false],
      }),
    ).toEqual({
      filters: [{ key: "code", name: "code", op: "eq", value: "O'Brien", numeric: false }],
    });
    expect(
      keyFilters({
        from: LINE.from.columns,
        onto: LINE.to.columns,
        columns,
        row: ["1", "1", null, ""],
        numeric,
      }),
    ).toEqual({ error: "line is NULL: the key points at no row." });
    expect(
      keyFilters({
        from: LINE.from.columns,
        onto: LINE.to.columns,
        columns: ["id", "order_id"],
        row: ["1", "1"],
        numeric,
      }),
    ).toEqual({ error: "line is not in this result: add it to follow the key." });
  });

  it("lists the keys that point at a table from every schema the cache holds", async () => {
    const { cache } = cacheOver(linksCatalog);
    await cache.open(PG);
    const view = cache.view(PG);
    const people = keysOfCache(view, "public", "people");
    expect(people?.outgoing).toEqual([]);
    expect(people?.incoming.map((k) => k.name)).toEqual([
      "old_orders_person_fkey",
      "orders_person_fkey",
    ]);
    expect(people?.incoming[0]).toEqual(
      key(
        "old_orders_person_fkey",
        ["archive", "old_orders", ["person"]],
        ["public", "people", ["id"]],
      ),
    );
    const staff = keysOfCache(view, "public", "staff");
    expect(staff?.outgoing).toEqual([
      key("staff_boss_fkey", ["public", "staff", ["boss"]], ["public", "staff", ["id"]]),
    ]);
    expect(staff?.incoming.map((k) => k.name)).toEqual(["staff_boss_fkey"]);
    expect(keysOfCache(view, "public", "notes")?.outgoing).toEqual([LINE]);
    // What the cache does not hold is read from the catalog instead.
    expect(keysOfCache(view, "public", "made_since")).toBeUndefined();
    expect(keysOfCache(view, "sales", "leads")).toBeUndefined();
    expect(keysOfCache(undefined, "public", "people")).toBeUndefined();
  });

  it("reads the keys of a table from pg_constraint's rows, both ways", () => {
    const sql = keysSql("pub'lic", 'Peo"ple');
    expect(sql).toContain("k.contype = 'f'");
    expect(sql).toContain("k.conparentid = 0");
    expect(sql).toContain("cn.nspname = 'pub''lic' AND c.relname = 'Peo\"ple'");
    expect(sql).toContain("rn.nspname = 'pub''lic' AND r.relname = 'Peo\"ple'");
    const rows = [
      ["orders_person_fkey", "public", "orders", '["person"]', "public", "people", '["id"]'],
      ["people_team_fkey", "public", "people", '["team", "site"]', "hr", "teams", '["id", "site"]'],
    ];
    expect(keysOfRows(rows, "public", "people")).toEqual({
      outgoing: [
        key(
          "people_team_fkey",
          ["public", "people", ["team", "site"]],
          ["hr", "teams", ["id", "site"]],
        ),
      ],
      incoming: [PERSON],
    });
  });

  it("writes the referenced table's search with quoted names, literal text and one page", () => {
    expect(
      searchSql("postgresql", {
        schema: "public",
        table: "people",
        key: ["id"],
        readable: "name",
        text: "",
        offset: 0,
      }),
    ).toBe('SELECT "id", "name" FROM "public"."people" ORDER BY "id" LIMIT 51 OFFSET 0');
    expect(
      searchSql("postgresql", {
        schema: "public",
        table: 'li"nes',
        key: ["order_id", "line"],
        readable: "",
        text: "50%_o'k",
        offset: 50,
      }),
    ).toBe(
      'SELECT "order_id", "line" FROM "public"."li""nes" WHERE ' +
        `CAST("order_id" AS text) ILIKE '%50!%!_o''k%' ESCAPE '!' OR ` +
        `CAST("line" AS text) ILIKE '%50!%!_o''k%' ESCAPE '!' ORDER BY "order_id", "line" LIMIT 51 OFFSET 50`,
    );
  });

  it("picks the readable column: the first text column outside the key, or none", () => {
    const columns = [
      { name: "id", type: "integer" },
      { name: "joined", type: "timestamp with time zone" },
      { name: "code", type: "character varying(8)" },
      { name: "name", type: "text" },
    ];
    expect(readableColumn(columns, ["id"])).toBe("code");
    expect(readableColumn(columns, ["code"])).toBe("name");
    expect(readableColumn(columns.slice(0, 2), ["id"])).toBe("");
  });

  it("keeps the trail back, at most 50 steps", () => {
    const trail = createTrail();
    expect(trail.pop()).toBeUndefined();
    for (let i = 0; i < 55; i++) trail.push({ id: `b${i}`, table: null });
    expect(trail.size()).toBe(50);
    expect(trail.pop()?.id).toBe("b54");
    for (let i = 0; i < 49; i++) trail.pop();
    expect(trail.pop()).toBeUndefined();
  });
});
