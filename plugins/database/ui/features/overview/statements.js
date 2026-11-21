// The overview's heaviest statements (sections.js): the connection's database's 20 statements that
// took the most time, from pg_stat_statements in the schema it was created in, with its columns by
// version (1.8 renamed total_time and mean_time to total_exec_time and mean_exec_time; 1.9 added
// pg_stat_statements_info and its reset time). When the extension is missing, or created but not
// loaded by the server, the section runs nothing and says how it is enabled; the overview never
// installs it. No DOM.

import { atLeast, ident, lines } from "./sql.js";

/**
 * @typedef {import("./sql.js").Section} Section
 * @typedef {import("./probe.js").Server} Server
 */

const NEVER = "The overview only reads: it never installs it.";
const CREATE =
  "run CREATE EXTENSION pg_stat_statements in this database (as its owner or a superuser)";
const PRELOAD =
  "add pg_stat_statements to shared_preload_libraries in postgresql.conf and restart the server";

/** The sentence for a pg_stat_statements created in the database that the server does not load. */
export const NOT_LOADED = `pg_stat_statements is created in this database but the server does not load it: ${PRELOAD}. ${NEVER}`;

/** How pg_stat_statements is enabled on this server, when it is not created in the database. */
export function enableSteps(/** @type {Server} */ server) {
  const { available, preload } = server.pgss;
  if (!available)
    return `pg_stat_statements is not on this server: install PostgreSQL's contrib modules, ${PRELOAD}, then ${CREATE}. ${NEVER}`;
  if (preload === null)
    return `pg_stat_statements is not created in this database: ${CREATE}. If the server does not load it yet, ${PRELOAD} first. ${NEVER}`;
  const loaded = preload
    .split(",")
    .map((name) => name.trim().replace(/^"|"$/gu, ""))
    .includes("pg_stat_statements");
  if (loaded)
    return `The server loads pg_stat_statements but it is not created in this database: ${CREATE}. ${NEVER}`;
  return `pg_stat_statements is not enabled: ${PRELOAD}, then ${CREATE}. ${NEVER}`;
}

/** @param {Server} server @returns {Section} */
export function statementsSection(server) {
  const { version, schema } = server.pgss;
  /** @type {Section} */
  const section = {
    id: "statements",
    title: "Heaviest statements",
    source: `pg_stat_statements${version ? ` ${version}` : ""}`,
    counters: "statements",
    columns: [
      { key: "total_ms", label: "Total", format: "ms" },
      { key: "calls", label: "Calls", format: "count" },
      { key: "mean_ms", label: "Mean", format: "ms" },
      { key: "rows", label: "Rows", format: "count" },
      { key: "hit_percent", label: "Cache hit %", format: "percent" },
      { key: "role", label: "Role" },
      { key: "query", label: "Statement", format: "query" },
    ],
    empty: "pg_stat_statements holds no statement of this database yet.",
  };
  if (!version) return { ...section, missing: enableSteps(server) };
  const from = ident(schema ?? "public");
  const exec = atLeast(version, "1.8");
  const total = exec ? "total_exec_time" : "total_time";
  const mean = exec ? "mean_exec_time" : "mean_time";
  const info = atLeast(version, "1.9");
  return {
    ...section,
    sql: lines(
      `SELECT round(st.${total}::numeric, 2) AS total_ms, st.calls, round(st.${mean}::numeric, 3) AS mean_ms,`,
      "  st.rows, round(100.0 * st.shared_blks_hit / nullif(st.shared_blks_hit + st.shared_blks_read, 0), 2) AS hit_percent,",
      "  r.rolname AS role, st.query",
      info && `  , (SELECT i.stats_reset FROM ${from}.pg_stat_statements_info i) AS since`,
      `FROM ${from}.pg_stat_statements st LEFT JOIN pg_roles r ON r.oid = st.userid`,
      "WHERE st.dbid = (SELECT d.oid FROM pg_database d WHERE d.datname = current_database())",
      `ORDER BY st.${total} DESC LIMIT 20`,
    ),
  };
}

/** Whether pg_stat_statements records when it was reset (1.9 and later). */
export const recordsReset = (/** @type {Server} */ server) =>
  server.pgss.version !== null && atLeast(server.pgss.version, "1.9");
