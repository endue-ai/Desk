// The ER diagram's graph (PG-55, ui/features/diagram/model.js): read from the schema cache's public
// view across schemas, each column's type, nullability, keys and comment and each end's cardinality;
// which tables a diagram shows (a schema, a filter, a table's neighbours either way, the person's
// additions and removals, new and dropped tables); and a drawn relation marked as not in the database.
import { describe, expect, it } from "vitest";
import {
  type Graph,
  graphFromCache,
  graphFromRows,
  idOf,
  merge,
  nameOf,
  neighbours,
  shownIds,
  subgraph,
  uniqueSets,
  withDrawn,
} from "../ui/features/diagram/model.js";
import { diagramOf } from "../ui/schema/diagram.js";
import { storeCatalog } from "./diagram-fixture";
import { cacheOver, PG } from "./schema-cache-helpers";

async function storeGraph(model = storeCatalog()): Promise<Graph> {
  const { cache } = cacheOver(() => model);
  await cache.open(PG);
  const view = cache.view(PG);
  if (!view) throw new Error("no cache view");
  return graphFromCache(view, ["public", "sales"]);
}
const names = (ids: Iterable<string>) => [...ids].map((id) => id.replace("\u0000", ".")).sort();
const link = (g: Graph, name: string) => g.links.find((l) => l.name === name);

describe("the diagram's graph", () => {
  it("builds the graph from the schema cache across schemas", async () => {
    const g = await storeGraph();
    expect(names(g.tables.map((t) => t.id))).toEqual([
      "public.audit",
      "public.customers",
      "public.invoices",
      "public.notes",
      "public.order_lines",
      "public.orders",
      "public.products",
      "sales.leads",
    ]);
    const customers = g.tables.find((t) => t.id === idOf("public", "customers"));
    expect(customers?.comment).toBe("Who buys");
    expect(customers?.columns).toEqual([
      { name: "id", type: "integer", nullable: false, primary: true, foreign: false, comment: "" },
      { name: "name", type: "text", nullable: false, primary: false, foreign: false, comment: "" },
      {
        name: "email",
        type: "text",
        nullable: true,
        primary: false,
        foreign: false,
        comment: "Where receipts go",
      },
    ]);
    const orders = g.tables.find((t) => t.name === "orders");
    expect(orders?.columns.find((c) => c.name === "customer_id")).toMatchObject({ foreign: true });
    // A key across schemas, and each end's cardinality.
    expect(link(g, "leads_customer_fkey")).toMatchObject({
      from: idOf("sales", "leads"),
      to: idOf("public", "customers"),
      fromColumns: ["customer_id"],
      toColumns: ["id"],
      drawn: false,
      ends: { from: "many", to: "zero-one" },
    });
    expect(link(g, "orders_customer_fkey")?.ends).toEqual({ from: "many", to: "one" });
    expect(link(g, "invoices_order_fkey")?.ends).toEqual({ from: "zero-one", to: "one" });
    expect(link(g, "order_lines_product_fkey")?.ends).toEqual({ from: "many", to: "zero-one" });
    // The cache of one schema alone leaves the key into it out.
    const { cache } = cacheOver(() => storeCatalog());
    await cache.open(PG);
    const sales = graphFromCache(cache.view(PG) as never, ["sales"]);
    expect(sales.links).toEqual([]);
    expect(uniqueSets([{ kind: "unique", detail: 'UNIQUE (a, "b ""c""")' }])).toEqual([
      ["a", 'b "c"'],
    ]);
  });

  it("reads another engine's rows, with nullability and comments where given", () => {
    const g = graphFromRows(
      "main",
      diagramOf(
        [
          ["orders", "id", "integer", "YES", "NO", ""],
          ["orders", "person", "integer", "NO", "YES", "Who placed it"],
          ["people", "id", "integer", "YES"],
        ],
        [["orders", "orders_person_fk", "person", "people", "id"]],
      ),
    );
    expect(g.tables[0]?.columns[1]).toEqual({
      name: "person",
      type: "integer",
      nullable: true,
      primary: false,
      foreign: true,
      comment: "Who placed it",
    });
    expect(g.tables[1]?.columns[0]?.nullable).toBe(false);
    expect(g.links[0]).toMatchObject({ from: idOf("main", "orders"), ends: { to: "zero-one" } });
    expect(merge([g, g]).tables).toHaveLength(2);
    expect(merge([g, g]).links).toHaveLength(1);
  });

  it("chooses tables", async () => {
    const g = await storeGraph();
    expect(names(shownIds(g, { schemas: ["public"] }))).toHaveLength(7);
    expect(names(shownIds(g, { schemas: ["public"], filter: "ORDER" }))).toEqual([
      "public.order_lines",
      "public.orders",
    ]);
    const around = (depth: number) =>
      names(shownIds(g, { schemas: ["public"], around: ["public", "orders"], depth }));
    expect(around(1)).toEqual([
      "public.customers",
      "public.invoices",
      "public.order_lines",
      "public.orders",
    ]);
    expect(around(2)).toEqual([
      "public.customers",
      "public.invoices",
      "public.order_lines",
      "public.orders",
      "public.products",
      "sales.leads",
    ]);
    expect(names(neighbours(g, idOf("public", "notes"), 3))).toEqual(["public.notes"]);
    // The person's additions and removals; a table no longer there is gone.
    const changed = shownIds(
      g,
      { schemas: ["public"], filter: "order" },
      {
        added: [
          ["public", "notes"],
          ["public", "dropped_long_ago"],
        ],
        removed: [["public", "order_lines"]],
      },
    );
    expect(names(changed)).toEqual(["public.notes", "public.orders"]);
    // A new table of a whole-schema diagram is shown; a dropped one is not.
    const model = storeCatalog();
    model.public?.tables?.push({ name: "refunds", columns: [["id", "integer", "np"]] });
    model.public?.tables?.splice(
      model.public.tables.findIndex((t) => t.name === "notes"),
      1,
    );
    const later = await storeGraph(model);
    const shown = names(shownIds(later, { schemas: ["public"] }));
    expect(shown).toContain("public.refunds");
    expect(shown).not.toContain("public.notes");
    expect(subgraph(g, shownIds(g, { schemas: ["sales"] })).links).toEqual([]);
    expect(nameOf({ schemas: ["public"] })).toBe("public");
    expect(nameOf({ schemas: ["public", "sales"] })).toBe("public, sales");
    expect(nameOf({ schemas: ["public"], around: ["public", "orders"], depth: 2 })).toBe(
      "public.orders ±2",
    );
    expect(nameOf({ schemas: ["public"], filter: "ord" })).toBe('public matching "ord"');
  });

  it("keeps a drawn relation and marks it as not in the database", async () => {
    const g = withDrawn(await storeGraph(), [
      {
        from: ["public", "audit"],
        to: ["public", "customers"],
        columns: ["actor"],
        refColumns: ["id"],
      },
      { from: ["public", "audit"], to: ["public", "gone"], columns: [], refColumns: [] },
    ]);
    const drawn = g.links.filter((l) => l.drawn);
    expect(drawn).toEqual([
      {
        name: "audit (actor) → customers (id)",
        from: idOf("public", "audit"),
        to: idOf("public", "customers"),
        fromColumns: ["actor"],
        toColumns: ["id"],
        drawn: true,
        ends: { from: "many", to: "zero-one" },
      },
    ]);
    expect(names(neighbours(g, idOf("public", "audit"), 1))).toEqual([
      "public.audit",
      "public.customers",
    ]);
  });
});
