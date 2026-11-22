// A scripted PostgreSQL server for the source search (ui/features/source-search/): the value search's
// `ledger` database (search-fixture.ts) with its schema cache's answers (pg-catalog.ts) grown by what
// mentions the column `customer`: a function, a procedure, a view and a materialized view whose
// definitions it answers to pg_get_functiondef and pg_get_viewdef (in batches and one at a time, as a
// source console reads one), a trigger, a check, a default, a policy and comments. Every other
// statement goes to the script behind it. Fixture data only; it needs no Node.
import type { Answer, Script } from "./clients";
import { catalogScript, type PgCatalog } from "./pg-catalog";
import { ledgerCatalog, SEARCH_CONNECTION } from "./search-fixture";

/** The definitions pg_get_functiondef answers, by oid. */
export const FUNCTIONS: Record<string, string> = {
  "16410": [
    "CREATE OR REPLACE FUNCTION public.order_total(customer integer)",
    " RETURNS numeric",
    " LANGUAGE sql",
    " STABLE",
    "AS $function$",
    "  -- sums the orders of one customer",
    "  SELECT sum(total) FROM public.orders o WHERE o.customer = $1",
    "$function$",
    "",
  ].join("\n"),
  "16411": [
    "CREATE OR REPLACE PROCEDURE public.close_orders()",
    " LANGUAGE sql",
    "AS $procedure$",
    "  UPDATE public.orders SET placed = now() WHERE placed IS NULL",
    "$procedure$",
    "",
  ].join("\n"),
};

/** The definitions pg_get_viewdef answers, by schema and name. */
export const VIEWS: Record<string, Record<string, string>> = {
  public: {
    customer_orders: " SELECT o.id,\n    o.customer,\n    o.total\n   FROM orders o;",
  },
  sales: {
    invoice_totals: " SELECT i.number,\n    i.memo AS customer_memo\n   FROM sales.invoices i;",
  },
};

const POLICY = JSON.stringify({
  cmd: "*",
  permissive: true,
  roles: [null],
  using: "(customer = current_customer())",
  check: null,
  comment: null,
});

/**
 * The ledger's cache with the objects that mention `customer`; `materialized` adds the materialized
 * view (the runtime page leaves it out: the value search would read it as a table).
 */
export function sourceCatalog(materialized = true): PgCatalog {
  const out = ledgerCatalog();
  const pub = out.public;
  const sales = out.sales;
  if (!pub || !sales) throw new Error("the ledger has public and sales");
  pub.tables = (pub.tables ?? []).map((t) => {
    if (t.name === "customers") return { ...t, comment: "Every customer we have" };
    if (t.name !== "orders") return t;
    return {
      ...t,
      columns: (t.columns ?? []).map((c) =>
        c[0] === "customer" ? ["customer", "integer", "", "current_customer()", "Who ordered"] : c,
      ),
      constraints: [["c", "orders_customer_check", "CHECK (customer > 0)", ["customer"]]],
      triggers: [
        [
          "orders_audit",
          "CREATE TRIGGER orders_audit AFTER UPDATE OF customer ON public.orders FOR EACH ROW EXECUTE FUNCTION audit_order()",
        ],
      ],
    };
  });
  pub.tables.push({
    name: "customer_orders",
    kind: "v",
    columns: [
      ["id", "integer"],
      ["customer", "integer"],
      ["total", "numeric(10,2)"],
    ],
  });
  pub.routines = [
    ["close_orders", "", "p", "", "16411"],
    ["order_total", "customer integer", "f", "numeric", "16410", "Total per customer"],
  ];
  pub.rows = { "table parts": [["orders", "policy", "own_orders", "all", POLICY]] };
  if (materialized)
    sales.tables = [
      ...(sales.tables ?? []),
      {
        name: "invoice_totals",
        kind: "m",
        columns: [
          ["number", "integer"],
          ["customer_memo", "text"],
        ],
      },
    ];
  return out;
}

const literal = (sql: string, after: string) =>
  (new RegExp(`${after} = '((?:[^']|'')*)'`, "u").exec(sql)?.[1] ?? "").replaceAll("''", "'");

/** The definitions' answers, or undefined for another statement. */
export function definitions(sql: string): Answer | undefined {
  const batch =
    /pg_get_functiondef\(p\.oid\) FROM pg_catalog\.pg_proc p WHERE p\.oid IN \(([\d, ]+)\)/u.exec(
      sql,
    );
  if (batch)
    return {
      rows: [
        ["oid", "pg_get_functiondef"],
        ...(batch[1] ?? "")
          .split(",")
          .map((oid) => oid.trim())
          .filter((oid) => FUNCTIONS[oid] !== undefined)
          .map((oid) => [oid, FUNCTIONS[oid] ?? ""]),
      ],
    };
  const one = /^SELECT pg_catalog\.pg_get_functiondef\((\d+)::oid\)$/u.exec(sql.trim());
  if (one) return { rows: [["pg_get_functiondef"], [FUNCTIONS[one[1] ?? ""] ?? ""]] };
  if (!sql.includes("pg_get_viewdef(c.oid, true)")) return undefined;
  const views = VIEWS[literal(sql, "n.nspname")] ?? {};
  if (sql.includes("c.relname = "))
    return { rows: [["pg_get_viewdef"], [views[literal(sql, "c.relname")] ?? ""]] };
  return {
    rows: [
      ["relname", "pg_get_viewdef"],
      ...Object.entries(views).map(([name, def]) => [name, def]),
    ],
  };
}

export interface SourceServerOptions {
  /** The materialized view is in the cache (see sourceCatalog). */
  materialized?: boolean;
  /** A batch of definitions of this schema runs on the server until it is cancelled. */
  waits?: string;
  /** Called with each statement of the ledger's database this server answers. */
  seen?: (sql: string) => void;
}

/** The source search's server in front of another script, for the ledger's database only. */
export function sourceServer(base: Script = () => ({}), options: SourceServerOptions = {}): Script {
  const catalog = catalogScript(() => sourceCatalog(options.materialized ?? true));
  return (sql, who) => {
    if (who.database !== SEARCH_CONNECTION.database) return base(sql, who);
    const defs = definitions(sql);
    if (defs) {
      options.seen?.(sql);
      if (options.waits && sql.includes(`'${options.waits}'`)) return { waits: true };
      return defs;
    }
    const cached = catalog(sql, who);
    if (cached !== "auth" && cached.rows) return cached;
    return base(sql, who);
  };
}
