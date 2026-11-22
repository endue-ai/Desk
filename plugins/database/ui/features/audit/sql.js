// The statements behind agents' read tools (PG-91): EXPLAIN in each engine's form, a table's first
// rows, PostgreSQL's statistics of a table and its columns (pg_class, pg_stat_all_tables, pg_stats),
// the server's sessions (pg_stat_activity), and a check that asks the server to prepare a statement
// without running it. Names and texts are quoted by the dialect's rules. No DOM.

import { tableName } from "../../catalog.js";
import { quoteText } from "../../sql/quote.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 */

/** The name of the statement a check prepares, and lets go of after. */
export const CHECK_NAME = "endue_agent_check";
const CHECK_PREFIX = `PREPARE ${CHECK_NAME} AS `;
/** The verbs PostgreSQL prepares. */
export const PREPARED = new Set([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "VALUES",
  "TABLE",
]);

/** EXPLAIN of a statement, with ANALYZE when asked (which runs it). */
export function explainSql(
  /** @type {Connection["engine"]} */ engine,
  /** @type {string} */ text,
  analyze = false,
) {
  if (engine === "postgresql")
    return `EXPLAIN (${analyze ? "ANALYZE, BUFFERS, " : ""}FORMAT TEXT) ${text}`;
  if (engine === "mysql") return `EXPLAIN ${analyze ? "ANALYZE " : ""}${text}`;
  return `EXPLAIN QUERY PLAN ${text}`;
}

/** A table's first rows. */
export const sampleSql = (
  /** @type {Connection} */ conn,
  /** @type {string} */ schema,
  /** @type {string} */ table,
  /** @type {number} */ limit,
) => `SELECT * FROM ${tableName(conn, schema, table)} LIMIT ${limit} OFFSET 0`;

/** A PostgreSQL table's size and activity, then its columns' statistics. */
export function statsSql(/** @type {string} */ schema, /** @type {string} */ table) {
  const [s, t] = [quoteText("postgresql", schema), quoteText("postgresql", table)];
  return [
    `SELECT c.reltuples::bigint AS estimated_rows, pg_total_relation_size(c.oid) AS total_bytes, pg_relation_size(c.oid) AS table_bytes, st.seq_scan, st.idx_scan, st.n_live_tup, st.n_dead_tup, st.n_mod_since_analyze, st.last_vacuum, st.last_autovacuum, st.last_analyze, st.last_autoanalyze FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_stat_all_tables st ON st.relid = c.oid WHERE n.nspname = ${s} AND c.relname = ${t}`,
    `SELECT attname, null_frac, avg_width, n_distinct, correlation, most_common_vals::text AS most_common_vals, most_common_freqs::text AS most_common_freqs, histogram_bounds::text AS histogram_bounds FROM pg_stats WHERE schemaname = ${s} AND tablename = ${t} ORDER BY attname`,
  ];
}

/** The server's sessions but the one asking, each statement cut at 500 characters. */
export const SESSIONS_SQL =
  "SELECT pid, usename AS user, datname AS database, application_name, client_addr::text AS client, backend_type, state, wait_event_type, wait_event, backend_start, xact_start, query_start, left(query, 500) AS query FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY pid";

/** The statements of a check: prepared, never executed, then let go of. */
export const checkSql = (/** @type {string} */ text) => [
  `${CHECK_PREFIX}${text}`,
  `DEALLOCATE ${CHECK_NAME}`,
];

/** A position in a check's PREPARE, as an offset in the agent's statement. */
export const checkPosition = (/** @type {number | undefined} */ position) =>
  position === undefined ? undefined : Math.max(0, position - CHECK_PREFIX.length);

/** A result set as objects, by column. */
export function objectsOf(
  /** @type {import("../../engines/common.js").ResultSet | undefined} */ set,
) {
  if (!set) return [];
  return set.rows.map((row) => Object.fromEntries(set.columns.map((c, i) => [c, row[i] ?? null])));
}
