// PG-80: the palette's database names are matched the palette's own way (its score, held equal to
// plugins/palette/ui/match.js, and its rating: the shown name before the qualified one, a query held
// whole leaving fragments out), and stay fast with a hundred thousand names of a schema cache.
import { describe, expect, it } from "vitest";
import { score as paletteScore } from "../../palette/ui/match.js";
import { findObjects } from "../ui/features/palette/index.js";
import { best, score } from "../ui/features/palette/match.js";
import { namesOf } from "../ui/features/palette/names.js";
import { viewOf } from "../ui/schema-cache/view.js";
import { PG } from "./schema-cache-helpers";

const TEXTS = [
  "Open a file",
  "reopen a file",
  "orders",
  "public.orders",
  "order_lines",
  "big_orders",
  "customer_id",
  "public.orders.customer_id",
  "people_id_seq",
  "refund(order_id integer)",
  "metrics.visits",
  "Ünïcode_tåble",
  "",
];
const QUERIES = [
  "o",
  "or",
  "ord",
  "orders",
  "ol",
  "cid",
  "pub.ord",
  "p o",
  "refund(",
  "zz",
  "ÜN",
  " orders ",
];

const named = (name: string, schema = "public", rank = 0) => ({
  name: name.toLowerCase(),
  qualified: `${schema}.${name}`.toLowerCase(),
  rank,
});

/** A cache of `tables` tables of `columns` columns each, in `schemas` schemas: no server. */
function bigView(tables: number, columns: number, schemas = 10) {
  const words = ["order", "customer", "invoice", "line", "item", "product", "price", "stock"];
  const held = new Map();
  for (let s = 0; s < schemas; s++) {
    const relations: string[][] = [];
    const cols: string[][] = [];
    for (let t = 0; t < tables / schemas; t++) {
      const name = `${words[t % 8]}_${words[(t * 3 + s) % 8]}_${t}`;
      relations.push([name, t % 10 === 0 ? "v" : "r", "0", String(t), "", "", ""]);
      for (let c = 0; c < columns; c++)
        cols.push([name, `${words[(c + t) % 8]}_${c}`, "integer", "", "", ""]);
    }
    const name = `schema_${s}`;
    held.set(name, { name, mark: "1", readAt: 1, data: { relations, columns: cols } });
  }
  return viewOf(
    {
      schemas: held,
      all: [...held.keys()].map((n) => [n, ""] as [string, string]),
      chosen: null,
      over: new Set(),
      readAt: 1,
      status: { state: "idle" },
      note: "",
    },
    false,
  );
}

describe("the palette's matching of database names", () => {
  it("scores every query against every text as the palette does", () => {
    for (const query of QUERIES)
      for (const text of TEXTS)
        expect(score(query, text), `${query} in ${text}`).toBe(paletteScore(query, text));
  });

  it("rates the shown name before the qualified one, leaves fragments out once one holds the query whole", () => {
    const items = [
      named("order_lines"),
      named("overdue_rates"),
      named("orders"),
      named("lines", "orders"),
    ];
    // "orders" is whole in orders (its name) and in orders.lines (only its qualified name).
    expect(best([items], "orders", 5).map((f) => f.item.qualified)).toEqual([
      "public.orders",
      "orders.lines",
    ]);
    // "ol" is a fragment everywhere: word starts first, the name shown before the qualified one.
    expect(best([items], "ol", 5).map((f) => f.item.name)).toEqual(["order_lines", "lines"]);
    expect(best([items], "o", 2)).toHaveLength(2);
    expect(best([items], "   ", 5)).toEqual([]);
  });

  it("breaks ties by the kind's rank, then where a name was found, and says the block", () => {
    const view = named("orders", "public", 1);
    const table = named("orders", "public", 0);
    const found = best([[view], [table]], "orders", 5);
    expect(found.map((f) => [f.item.rank, f.block])).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it("finds among a hundred thousand names of a cache in a few milliseconds", async () => {
    const view = bigView(20_000, 4);
    let started = performance.now();
    const blocks = namesOf(view);
    const built = performance.now() - started;
    expect(blocks.flat().length).toBe(20_000 * 5 + 10);
    // The names are made once per read of a schema.
    expect(namesOf(view)[0]).toBe(blocks[0]);
    expect(built).toBeLessThan(2000);
    const sources = { all: async () => [{ conn: PG, blocks: namesOf(view) }] };
    await findObjects({ query: "warm", limit: 8 }, sources);
    for (const query of ["or", "order_cust", "icu", "schema_3.inv", "zzz"]) {
      started = performance.now();
      const answer = await findObjects({ query, limit: 8 }, sources);
      expect(performance.now() - started, query).toBeLessThan(100);
      expect(answer.results.length, query).toBeLessThanOrEqual(8);
    }
    const exact = await findObjects({ query: "customer_price_9", limit: 3 }, sources);
    expect(exact.results[0]).toMatchObject({ title: "customer_price_9", kind: "table" });
  });
});
