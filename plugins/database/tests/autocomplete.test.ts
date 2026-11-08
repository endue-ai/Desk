// Autocomplete from an introspected schema: tables after FROM and JOIN, columns through aliases and
// qualified names, schemas, keywords and functions; nothing inside strings and comments; tables
// whose columns are not read yet asked for.
import { describe, expect, it } from "vitest";
import { complete, type SchemaView } from "../ui/editor/complete.js";
import { highlight } from "../ui/editor/highlight.js";

const TABLES: Record<string, { name: string; type: string }[]> = {
  public: [
    { name: "orders", type: "table" },
    { name: "order_items", type: "table" },
    { name: "customers", type: "table" },
    { name: "Mixed Case", type: "table" },
    { name: "active_customers", type: "view" },
  ],
  audit: [{ name: "events", type: "table" }],
};
const COLUMNS: Record<string, { name: string; type: string }[]> = {
  "public.orders": [
    { name: "id", type: "integer" },
    { name: "customer_id", type: "integer" },
    { name: "total", type: "numeric(10,2)" },
  ],
  "public.customers": [
    { name: "id", type: "integer" },
    { name: "name", type: "text" },
    { name: "order", type: "text" },
  ],
  "audit.events": [{ name: "at", type: "timestamptz" }],
};

const schema = (loaded = COLUMNS): SchemaView => ({
  defaultSchema: "public",
  schemas: () => Object.keys(TABLES),
  tables: (s) => TABLES[s],
  columns: (s, t) => loaded[`${s}.${t}`],
});

/** Completions at the `|` in `sql`. */
function at(
  sql: string,
  view = schema(),
  dialect: "postgresql" | "mysql" | "sqlite" = "postgresql",
) {
  const caret = sql.indexOf("|");
  return complete(sql.replace("|", ""), caret, dialect, view);
}
const labels = (sql: string, view = schema()) => at(sql, view).items.map((i) => i.label);

describe("autocomplete", () => {
  it("offers tables, views and schemas after FROM and JOIN, filtered by the word typed", () => {
    expect(labels("select * from |")).toEqual([
      "active_customers",
      "customers",
      "Mixed Case",
      "order_items",
      "orders",
      "audit",
    ]);
    const typed = at("select * from ord|");
    expect(typed.items.map((i) => i.label)).toEqual(["order_items", "orders"]);
    expect([typed.from, typed.to]).toEqual([14, 17]);
    expect(labels("select * from orders o join cus|")).toEqual(["customers", "active_customers"]);
    expect(labels("select * from orders, cust|")).toEqual(["customers", "active_customers"]);
    expect(at("select * from Mix|").items[0]?.insert).toBe('"Mixed Case"');
    expect(labels("select * from audit.|")).toEqual(["events"]);
  });

  it("offers a table's columns through its alias or its name, and the aliases themselves", () => {
    expect(labels("select o.| from orders o")).toEqual(["customer_id", "id", "total"]);
    expect(
      labels("select c.na| from orders as o join customers c on c.id = o.customer_id"),
    ).toEqual(["name"]);
    expect(labels("select orders.to| from orders")).toEqual(["total"]);
    expect(labels("select public.customers.| from customers")).toEqual(["id", "name", "order"]);
    const columns = at("select | from orders o join customers c on true").items;
    expect(columns.filter((i) => i.kind === "column").map((i) => `${i.label}:${i.detail}`)).toEqual(
      [
        "customer_id:integer · o",
        "id:integer · o",
        "id:integer · c",
        "name:text · c",
        "order:text · c",
        "total:numeric(10,2) · o",
      ],
    );
    expect(columns.filter((i) => i.kind === "alias").map((i) => i.label)).toEqual(["c", "o"]);
    expect(at("select c.or| from customers c").items[0]?.insert).toBe('"order"');
  });

  it("asks for the columns it has not read yet", () => {
    const empty = schema({});
    const result = at("select | from orders o, audit.events e where o.id = 1", empty);
    expect(result.wants).toEqual([
      { schema: "public", table: "orders" },
      { schema: "audit", table: "events" },
    ]);
  });

  it("offers keywords and functions in the case typed, and nothing in strings or comments", () => {
    const items = at("sel|").items;
    expect(items[0]).toMatchObject({ label: "SELECT", kind: "keyword", insert: "select" });
    expect(at("SEL|").items[0]?.insert).toBe("SELECT");
    expect(at("select coal|").items[0]).toMatchObject({ label: "coalesce", kind: "function" });
    expect(at("select 'fr|'").items).toEqual([]);
    expect(at("select 1 -- fr|").items).toEqual([]);
    expect(at("select * from t where a = $$ fr|$$").items).toEqual([]);
    expect(at("select 1; select * from |", schema(), "postgresql").items[0]?.label).toBe(
      "active_customers",
    );
  });

  it("reads MySQL's backticks and SQLite's brackets as names", () => {
    const view: SchemaView = {
      defaultSchema: "shop",
      schemas: () => ["shop"],
      tables: () => [{ name: "Order Lines", type: "table" }],
      columns: () => [{ name: "qty", type: "int" }],
    };
    expect(at("select l.| from `Order Lines` l", view, "mysql").items.map((i) => i.label)).toEqual([
      "qty",
    ]);
    expect(at("select * from Ord|", view, "mysql").items[0]?.insert).toBe("`Order Lines`");
    expect(at("select x.| from [Order Lines] x", view, "sqlite").items[0]?.label).toBe("qty");
  });
});

describe("highlight", () => {
  it("marks keywords, functions, strings, numbers, comments and names, and gives the text back", () => {
    const sql = "SELECT count(*), 'a;b' FROM \"t\" -- c\nWHERE x = 1 AND y = :p";
    const runs = highlight(sql, "postgresql");
    expect(runs.map((r) => r.text).join("")).toBe(sql);
    const kinds = Object.fromEntries(
      runs.filter((r) => r.kind !== "plain").map((r) => [r.text.trim(), r.kind]),
    );
    expect(kinds).toMatchObject({
      SELECT: "keyword",
      count: "function",
      "'a;b'": "string",
      FROM: "keyword",
      '"t"': "name",
      "-- c": "comment",
      WHERE: "keyword",
      "1": "number",
      AND: "keyword",
      ":p": "param",
    });
    const mysql = "DELIMITER //\nselect 1//";
    expect(
      highlight(mysql, "mysql")
        .map((r) => r.text)
        .join(""),
    ).toBe(mysql);
  });
});
