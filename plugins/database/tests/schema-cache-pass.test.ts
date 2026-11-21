// The schema cache's pass (PG-06): one statement for the fingerprints and one per kind, for every
// chosen schema at once, whatever their size; progress per step and Cancel between steps; a check
// that reads again only the schemas whose fingerprint moved; system schemas left out by default.
import { describe, expect, it } from "vitest";
import { kindOf, type PgCatalog, schemasOf, shop } from "./pg-catalog";
import { cacheOver, PG } from "./schema-cache-helpers";

const PASS = ["marks", "relations", "columns", "constraints", "indexes", "triggers", "routines"];

describe("the schema cache's pass", () => {
  it("reads every chosen schema in one pass of seven statements", async () => {
    const { cache, sqls } = cacheOver(() => shop());
    await cache.open(PG);
    expect(sqls.map(kindOf)).toEqual(PASS);
    for (const sql of sqls.slice(1)) expect(schemasOf(sql)).toEqual(["public", "sales"]);
    const view = cache.view(PG);
    expect(view?.listed()).toEqual(["public", "sales"]);
    expect(view?.objects("public")?.map((o) => [o.name, o.kind, o.rows])).toEqual([
      ["big_orders", "view", null],
      ["orders", "table", 2],
      ["people", "table", 4],
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
    expect(view?.parts("public", "people")?.map((p) => [p.kind, p.name, p.extra])).toEqual([
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

  it("a schema of ten thousand tables takes the same seven statements, with progress and Cancel", async () => {
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
    expect(sqls).toHaveLength(7);
    expect(steps).toEqual([
      "1 of 7 schemas",
      "2 of 7 tables and views",
      "3 of 7 columns",
      "4 of 7 keys and foreign keys",
      "5 of 7 indexes",
      "6 of 7 triggers",
      "7 of 7 routines",
    ]);
    expect(cache.view(PG)?.objects("public")).toHaveLength(10_000);
    expect(cache.view(PG)?.columns("public", "t09999")).toHaveLength(10);

    // A cancel after the third statement of the next pass runs nothing more and keeps what was read.
    cancelAt = sqls.length + 3;
    (model.public as { mark: string }).mark = "2";
    (model.public?.tables ?? []).splice(5000);
    await expect(cache.refresh(PG, { all: true })).rejects.toThrow(/Cancelled/u);
    expect(sqls).toHaveLength(10);
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
    expect(await cache.refresh(PG)).toEqual({ statements: 7, read: ["sales"] });
    for (const sql of sqls.slice(1)) expect(schemasOf(sql)).toEqual(["sales"]);
    expect(
      cache
        .view(PG)
        ?.objects("sales")
        ?.map((o) => o.name),
    ).toEqual(["leads", "visits"]);
    expect(cache.view(PG)?.objects("public")).toHaveLength(6);

    // One schema asked for is read whatever its fingerprint; an explicit reload reads them all.
    sqls.length = 0;
    expect((await cache.refresh(PG, { schemas: ["public"] })).read).toEqual(["public"]);
    sqls.length = 0;
    expect((await cache.refresh(PG, { all: true })).read).toEqual(["public", "sales"]);
    for (const sql of sqls.slice(1)) expect(schemasOf(sql)).toEqual(["public", "sales"]);

    // A schema dropped on the server goes from the cache.
    delete model.sales;
    await cache.refresh(PG);
    expect(cache.view(PG)?.listed()).toEqual(["public"]);
    expect(cache.view(PG)?.objects("sales")).toBeUndefined();
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
    expect(sqls.slice(1).map(schemasOf)).toEqual(Array(6).fill(["pg_catalog"]));
    expect(cache.view(PG)?.schemas()).toEqual(["pg_catalog", "sales"]);
    expect(cache.view(PG)?.listed()).toEqual(["pg_catalog", "public", "sales"]);
    expect(cache.view(PG)?.chosen("public")).toBe(false);

    sqls.length = 0;
    await cache.choose(PG, null);
    expect(sqls.slice(1).map(schemasOf)).toEqual(Array(6).fill(["public"]));
    expect(cache.view(PG)?.schemas()).toEqual(["public", "sales"]);
  });
});
