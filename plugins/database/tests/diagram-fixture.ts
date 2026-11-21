// The ER diagram's fixtures (PG-55): a small store over two schemas (public with customers, orders,
// lines, products, an invoice per order, a lone table and one a drawn relation can start from; sales
// with leads that refer to public's customers), and a generated schema of 500 tables and 1,000
// foreign keys, as the schema cache's catalog (pg-catalog.ts); the saved PostgreSQL connection
// "depot" whose scripted psql answers both, for the runtime e2e page. Fixture data only; nothing
// here needs Node.
import type { Connection } from "../ui/engines/common.js";
import type { Script } from "./clients";
import { answer, type PgCatalog, type PgTable } from "./pg-catalog";

/** The saved PostgreSQL connection of the diagram's e2e. */
export const DIAGRAM_CONNECTION: Connection = {
  id: "c-depot",
  name: "depot",
  engine: "postgresql",
  host: "db.example",
  port: 5432,
  database: "depot",
  user: "app",
  ssl: "default",
  sslCa: "",
  file: "",
  tag: "none",
  readOnly: false,
};

type Constraint = NonNullable<PgTable["constraints"]>[number];
const pk = (table: string, ...cols: string[]): Constraint => [
  "p",
  `${table}_pkey`,
  `PRIMARY KEY (${cols.join(", ")})`,
  cols,
];
const fk = (
  name: string,
  cols: string[],
  schema: string,
  table: string,
  refs: string[],
): Constraint => [
  "f",
  name,
  `FOREIGN KEY (${cols.join(", ")}) REFERENCES ${table}(${refs.join(", ")})`,
  cols,
  schema,
  table,
  refs,
];

/** The store: public's seven tables and sales' leads. */
export function storeCatalog(): PgCatalog {
  return {
    pg_catalog: { mark: "2.-", system: true, tables: [{ name: "pg_class" }] },
    public: {
      mark: "10.7:700",
      tables: [
        {
          name: "customers",
          comment: "Who buys",
          columns: [
            ["id", "integer", "np"],
            ["name", "text", "n"],
            ["email", "text", "", "", "Where receipts go"],
          ],
          constraints: [pk("customers", "id")],
        },
        {
          name: "orders",
          columns: [
            ["id", "integer", "np"],
            ["customer_id", "integer", "n"],
            ["placed", "timestamp with time zone", "n"],
            ["note", "text", ""],
          ],
          constraints: [
            pk("orders", "id"),
            fk("orders_customer_fkey", ["customer_id"], "public", "customers", ["id"]),
          ],
        },
        {
          name: "products",
          columns: [
            ["id", "integer", "np"],
            ["title", "text", "n"],
            ["price", "numeric(10,2)", "n"],
          ],
          constraints: [pk("products", "id")],
        },
        {
          name: "order_lines",
          columns: [
            ["order_id", "integer", "np"],
            ["line_no", "integer", "np"],
            ["product_id", "integer", ""],
            ["qty", "integer", "n"],
          ],
          constraints: [
            pk("order_lines", "order_id", "line_no"),
            fk("order_lines_order_fkey", ["order_id"], "public", "orders", ["id"]),
            fk("order_lines_product_fkey", ["product_id"], "public", "products", ["id"]),
          ],
        },
        {
          name: "invoices",
          columns: [
            ["id", "integer", "np"],
            ["order_id", "integer", "n"],
          ],
          constraints: [
            pk("invoices", "id"),
            ["u", "invoices_order_key", "UNIQUE (order_id)", ["order_id"]],
            fk("invoices_order_fkey", ["order_id"], "public", "orders", ["id"]),
          ],
        },
        { name: "notes", columns: [["body", "text", ""]] },
        {
          name: "audit",
          columns: [
            ["id", "integer", "np"],
            ["actor", "integer", ""],
          ],
          constraints: [pk("audit", "id")],
        },
        { name: "recent_orders", kind: "v", columns: [["id", "integer"]] },
      ],
    },
    sales: {
      mark: "11.1:100",
      tables: [
        {
          name: "leads",
          columns: [
            ["id", "bigint", "np"],
            ["customer_id", "integer", ""],
          ],
          constraints: [
            pk("leads", "id"),
            fk("leads_customer_fkey", ["customer_id"], "public", "customers", ["id"]),
          ],
        },
      ],
    },
  };
}

/** `count` tables t001… with `keys` foreign keys between them, the same every time. */
export function bigTables(count = 500, keys = 1000): PgTable[] {
  const names = Array.from({ length: count }, (_, i) => `t${String(i + 1).padStart(3, "0")}`);
  const columns = new Map(
    names.map((n) => [
      n,
      [
        ["id", "integer", "np"],
        ["name", "text", "n"],
      ],
    ]),
  );
  const constraints = new Map<string, Constraint[]>(names.map((n) => [n, [pk(n, "id")]]));
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const pairs = new Set<string>();
  while (pairs.size < keys) {
    const from = next() % count;
    // Mostly to an earlier table, so the schema has layers, as real ones do.
    const to = next() % Math.max(1, from);
    if (from === to || pairs.has(`${from}:${to}`)) continue;
    pairs.add(`${from}:${to}`);
    const child = names[from] as string;
    const parent = names[to] as string;
    const column = `${parent}_id`;
    columns.get(child)?.push([column, "integer", next() % 3 === 0 ? "" : "n"]);
    constraints.get(child)?.push(fk(`${child}_${parent}_fkey`, [column], "big", parent, ["id"]));
  }
  return names.map((name) => ({
    name,
    estimate: "100",
    columns: columns.get(name) ?? [],
    constraints: constraints.get(name) ?? [],
  }));
}

/** The store and, in schema big, 500 tables with 1,000 foreign keys. */
export function depotCatalog(): PgCatalog {
  return { ...storeCatalog(), big: { mark: "12.500:9000", tables: bigTables() } };
}

/** The scripted psql of "depot": the schema cache's statements from depotCatalog, else `base`. */
export function diagramServer(base: Script = () => ({})): Script {
  const model = depotCatalog();
  return (sql, env) => {
    if (env.PGDATABASE !== DIAGRAM_CONNECTION.database) return base(sql, env);
    const rows = answer(model, sql);
    return rows ? { rows } : base(sql, env);
  };
}
