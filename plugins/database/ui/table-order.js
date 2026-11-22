// A PostgreSQL table view's rows in a fixed order (#564). Without ORDER BY the server answers rows
// in whatever order it finds them, and an UPDATE writes a row anew, so after Submit the edited row
// would come back last. A table view the person has not sorted reads by its primary key's columns
// in the key's order, or by ctid (where each row lies) for a table, partitioned table or
// materialized view without one; a view or a foreign table is read as it is. The order is looked
// up once per table view, and the Order by field stays empty: it is the person's own order.

import { quoteText } from "./sql/quote.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {{ schema: string, name: string }} Relation
 */

/** Kinds of relation whose rows have a ctid to order by. */
const STORED = new Set(["r", "p", "m"]);

/**
 * The relation's kind and its primary key's columns, each quoted, in the key's order.
 * @param {string} schema An empty schema is the relation the search path finds.
 * @param {string} table
 */
export function naturalOrderSql(schema, table) {
  const where = schema
    ? `n.nspname = ${quoteText("postgresql", schema)}`
    : "pg_catalog.pg_table_is_visible(c.oid)";
  return (
    "SELECT c.relkind, coalesce((SELECT string_agg('\"' || replace(a.attname, '\"', '\"\"') || '\"', ', ' " +
    "ORDER BY k.n) FROM pg_catalog.pg_index i " +
    "CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, n) " +
    "JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum " +
    "WHERE i.indrelid = c.oid AND i.indisprimary), '') " +
    "FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
    `WHERE ${where} AND c.relname = ${quoteText("postgresql", table)}`
  );
}

/**
 * The ORDER BY a relation reads in when the person gave none.
 * @param {string} kind pg_class.relkind
 * @param {string} key The primary key's columns, quoted, or ""
 */
export function naturalOrder(kind, key) {
  if (key) return key;
  return STORED.has(kind) ? "ctid" : "";
}

/**
 * Looks up and keeps each table view's order.
 * @param {import("./catalog.js").Execute} execute
 */
export function createNaturalOrder(execute) {
  /** @type {WeakMap<Relation, { key: string, order: string }>} */
  const known = new WeakMap();
  /**
   * The order a table view reads in when the person gave none: "" for other engines, and when the
   * lookup fails (the rows then read as the server finds them).
   * @param {Connection} conn
   * @param {Relation} page
   */
  return async (conn, page) => {
    if (conn.engine !== "postgresql") return "";
    const key = `${page.schema}.${page.name}`;
    const kept = known.get(page);
    if (kept?.key === key) return kept.order;
    try {
      const looked = await execute(conn, naturalOrderSql(page.schema, page.name), {
        catalog: true,
      });
      const statement = looked.result.statements[0];
      if (looked.result.error || statement?.error) return "";
      const [kind = "", columns = ""] = statement?.sets[0]?.rows[0] ?? [];
      const order = naturalOrder(kind ?? "", columns ?? "");
      known.set(page, { key, order });
      return order;
    } catch {
      return "";
    }
  };
}
