// The schema cache's pass (PG-06): one statement for the fingerprints and one per kind, for every
// chosen schema at once, whatever their size; progress per step and Cancel between steps; a check
// that reads again only the schemas whose fingerprint moved; system schemas left out by default.
// PG-50 adds three per-schema readers and two of the database level (pg-kinds-pass.test.ts).
import { describe, expect, it } from "vitest";
import { isNewKind } from "../ui/schema/pg/index.js";
import { kindOf, type PgCatalog, schemasOf, shop } from "./pg-catalog";
import { cacheOver, PG } from "./schema-cache-helpers";

/** A pass over schemas only: the fingerprints and the nine per-schema readers. */
const SCHEMAS = [
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
];
/** A first pass: the schemas, then the database level's two readers. */
const PASS = [...SCHEMAS, "database", "server"];
const old = (o: { kind: string }) => !isNewKind(o.kind);

describe("the schema cache's pass", () => {
  it("reads every chosen schema in one pass of twelve statements", async () => {
    const { cache, sqls } = cacheOver(() => shop());
    await cache.open(PG);
    expect(sqls.map(kindOf)).toEqual(PASS);
    for (const sql of sqls.slice(1, 10)) expect(schemasOf(sql)).toEqual(["public", "sales"]);
    const view = cache.view(PG);
    expect(view?.listed()).toEqual(["public", "sales"]);
    expect(
      view
        ?.objects("public")
        ?.filter(old)
        .map((o) => [o.name, o.kind, o.rows]),
    ).toEqual([
      ["big_orders", "view", null],
      ["events", "table", null],
      ["orders", "table", 2],
      ["people", "table", 4],
      ["people_archive", "table", 0],
      ["people_id_seq", "sequence", null],
      ["refund(order_id integer)", "procedure", null],
      ["touch()", "function", null],
    ]);
    expect(view?.columns("public", "people")).toEqual([
      {
        name: "id",
        type: "integer",
        nullable: false,
        default: "nextval('people_id_seq'::regclass)",
        primary: true,
        comment: "",
      },
      {
        name: "name",
        type: "text",
        nullable: false,
        default: null,
        primary: false,
        comment: "Full name",
      },
      {
        name: "joined",
        type: "timestamp with time zone",
        nullable: true,
        default: "now()",
        primary: false,
        comment: "",
      },
    ]);
    expect(view?.parts("public", "orders")?.map((p) => [p.kind, p.name])).toEqual([
      ["check", "orders_total_check"],
      ["foreign key", "orders_person_fkey"],
      ["primary key", "orders_pkey"],
    ]);
    expect(
      view
        ?.parts("public", "people")
        ?.filter(old)
        .map((p) => [p.kind, p.name, p.extra]),
    ).toEqual([
      ["primary key", "people_pkey", ""],
      ["index", "people_name", ""],
      ["index", "people_pkey", "constraint"],
      ["trigger", "people_touch", ""],
    ]);
    expect(view?.foreignKeys("public", "orders")).toEqual([
      {
        name: "orders_person_fkey",
        columns: ["person"],
        schema: "public",
        table: "people",
        refColumns: ["id"],
      },
    ]);
    expect(view?.routines("public")).toEqual([
      {
        name: "refund",
        args: "order_id integer",
        kind: "procedure",
        result: "",
        ident: "16405",
        comment: "",
      },
      {
        name: "touch",
        args: "",
        kind: "function",
        result: "trigger",
        ident: "16404",
        comment: "Sets updated",
      },
    ]);
    expect(view?.comment("public", "people")).toBe("Who buys");
    // What it does not hold is left to the catalog: no such table, no such schema.
    expect(view?.columns("public", "nowhere")).toBeUndefined();
    expect(view?.objects("elsewhere")).toBeUndefined();
  });

  it("a schema of ten thousand tables takes the same ten statements, with progress and Cancel", async () => {
    const tables = Array.from({ length: 10_000 }, (_, i) => ({
      name: `t${String(i).padStart(5, "0")}`,
      columns: Array.from({ length: 10 }, (_, j) => [`c${j}`, "integer", j === 0 ? "np" : ""]),
    }));
    const model: PgCatalog = { public: { mark: "1", tables } };
    let cancelAt = 0;
    const { cache, sqls, steps } = cacheOver(() => model, {
      after: (_sql, count) => {
        if (count === cancelAt) cache.cancel(PG.id);
      },
    });
    await cache.open(PG);
    expect(sqls).toHaveLength(10);
    // No database level in this model: its two steps are passed over, the others keep their numbers.
    expect(steps).toEqual([
      "1 of 12 schemas",
      "2 of 12 tables and views",
      "3 of 12 columns",
      "4 of 12 keys and foreign keys",
      "5 of 12 indexes",
      "6 of 12 triggers",
      "7 of 12 routines",
      "8 of 12 types",
      "9 of 12 aggregates, operators, collations and text search",
      "10 of 12 partitions, inheritance, policies and rules",
    ]);
    expect(cache.view(PG)?.objects("public")).toHaveLength(10_000);
    expect(cache.view(PG)?.columns("public", "t09999")).toHaveLength(10);

    // A cancel after the third statement of the next pass runs nothing more and keeps what was read.
    cancelAt = sqls.length + 3;
    (model.public as { mark: string }).mark = "2";
    (model.public?.tables ?? []).splice(5000);
    await expect(cache.refresh(PG, { all: true })).rejects.toThrow(/Cancelled/u);
    expect(sqls).toHaveLength(13);
    expect(cache.view(PG)?.status).toMatchObject({ state: "cancelled" });
    expect(cache.view(PG)?.objects("public")).toHaveLength(10_000);
  }, 60_000);

  it("reads only what the catalog says changed", async () => {
    const model = shop();
    const { cache, sqls } = cacheOver(() => model);
    await cache.open(PG);
    sqls.length = 0;
    expect(await cache.refresh(PG)).toEqual({ statements: 1, read: [] });
    expect(sqls.map(kindOf)).toEqual(["marks"]);

    // Another session adds a table to sales: only sales is read again.
    const sales = model.sales as NonNullable<PgCatalog["sales"]>;
    sales.mark = "11.2:400";
    sales.tables?.push({ name: "visits", columns: [["id", "bigint", "np"]] });
    sqls.length = 0;
    expect(await cache.refresh(PG)).toEqual({ statements: 10, read: ["sales"] });
    expect(sqls.map(kindOf)).toEqual(SCHEMAS);
    for (const sql of sqls.slice(1)) expect(schemasOf(sql)).toEqual(["sales"]);
    expect(
      cache
        .view(PG)
        ?.objects("sales")
        ?.map((o) => o.name),
    ).toEqual(["leads", "visits"]);
    expect(cache.view(PG)?.objects("public")?.filter(old)).toHaveLength(8);

    // One schema asked for is read whatever its fingerprint; an explicit reload reads them all.
    sqls.length = 0;
    expect((await cache.refresh(PG, { schemas: ["public"] })).read).toEqual(["public"]);
    sqls.length = 0;
    expect(await cache.refresh(PG, { all: true })).toEqual({
      statements: 12,
      read: ["public", "sales"],
      database: true,
    });
    for (const sql of sqls.slice(1, 10)) expect(schemasOf(sql)).toEqual(["public", "sales"]);

    // A schema dropped on the server goes from the cache.
    delete model.sales;
    await cache.refresh(PG);
    expect(cache.view(PG)?.listed()).toEqual(["public"]);
    expect(cache.view(PG)?.objects("sales")).toBeUndefined();
  });

  it("a table renamed in one schema reads again the schemas whose foreign keys name it", async () => {
    const model = shop();
    const sales = model.sales as NonNullable<PgCatalog["sales"]>;
    sales.tables?.push({
      name: "visits",
      columns: [["person", "integer"]],
      constraints: [
        [
          "f",
          "visits_person_fkey",
          "FOREIGN KEY (person) REFERENCES people(id)",
          ["person"],
          "public",
          "people",
          ["id"],
        ],
      ],
    });
    const { cache, sqls } = cacheOver(() => model);
    await cache.open(PG);

    // A column added to the table the key names leaves the key as it was: public alone.
    const people = model.public?.tables?.find((t) => t.name === "people");
    people?.columns?.push(["age", "integer"]);
    (model.public as { mark: string }).mark = "10.4:400";
    expect((await cache.refresh(PG)).read).toEqual(["public"]);

    // Renamed: sales' key names a table that is no more, so sales is read again in the same pass.
    if (people) people.name = "persons";
    (model.public as { mark: string }).mark = "10.5:500";
    const fkey = sales.tables?.at(-1)?.constraints?.[0];
    if (fkey) fkey[5] = "persons";
    sqls.length = 0;
    expect(await cache.refresh(PG)).toEqual({ statements: 20, read: ["public", "sales"] });
    expect(sqls.slice(10).map(kindOf)).toEqual(SCHEMAS);
    for (const sql of sqls.slice(11)) expect(schemasOf(sql)).toEqual(["sales"]);
    expect(cache.view(PG)?.foreignKeys("sales", "visits")?.[0]?.table).toBe("persons");
  });

  it("reads the schemas the person chose; system schemas stay off", async () => {
    const model = { ...shop(), pg_toast: { mark: "3", system: true } };
    const { cache, sqls } = cacheOver(() => model);
    await cache.open(PG);
    expect(schemasOf(sqls[1] ?? "")).toEqual(["public", "sales"]);
    expect(cache.view(PG)?.listed()).toEqual(["public", "sales"]);

    const shown = cacheOver(() => model, { system: true });
    await shown.cache.open(PG);
    expect(shown.cache.view(PG)?.listed()).toEqual([
      "information_schema",
      "pg_catalog",
      "pg_toast",
      "public",
      "sales",
    ]);
    expect(schemasOf(shown.sqls[1] ?? "")).toEqual(["public", "sales"]);
    expect(shown.cache.view(PG)?.chosen("pg_catalog")).toBe(false);

    sqls.length = 0;
    await cache.choose(PG, ["sales", "pg_catalog"]);
    expect(sqls.slice(1).map(schemasOf)).toEqual(Array(9).fill(["pg_catalog"]));
    expect(cache.view(PG)?.schemas()).toEqual(["pg_catalog", "sales"]);
    expect(cache.view(PG)?.listed()).toEqual(["pg_catalog", "public", "sales"]);
    expect(cache.view(PG)?.chosen("public")).toBe(false);

    sqls.length = 0;
    await cache.choose(PG, null);
    expect(sqls.slice(1).map(schemasOf)).toEqual(Array(9).fill(["public"]));
    expect(cache.view(PG)?.schemas()).toEqual(["public", "sales"]);
  });
});
