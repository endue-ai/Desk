// The maintenance form's SQL, PostgreSQL 13 and later: the statement it runs (VACUUM, ANALYZE,
// REINDEX or CLUSTER in the server's syntax: CLUSTER's options go in parentheses from 14 on, and
// without a table from 17 on), what is read of the target before and after (the version, the
// sizes, pg_stat_all_tables' rows and dead rows and last runs, the indexes, the tablespaces, a
// schema's tables) and, while it runs, the server's progress views for the run's own session and
// the cancel of that session. No DOM.

import { quoteText, readableName } from "../../sql/quote.js";
import { clusterable, LABELS, on, partitionedTooOld, TITLES } from "./options.js";

/**
 * @typedef {import("./options.js").Target} Target
 * @typedef {import("./options.js").Operation} Operation
 * @typedef {import("./options.js").Options} Options
 * @typedef {import("./options.js").Known} Known
 * @typedef {{ target: Target, operation: Operation, options: Options }} Plan
 * @typedef {Known & { database: string, tables: string[] }} Facts
 *   `tables` are a schema's tables; `database` the connection's current one.
 */

/** The oldest server the form runs on (server_version_num), as the activity view. */
export const FLOOR = 130000;
const FOURTEEN = 140000;
const SEVENTEEN = 170000;
/** A size read waits this long for a lock another session holds, then says so. */
export const LOCK_TIMEOUT = "SET lock_timeout = 2000";

/**
 * PostgreSQL's reserved key words (its documentation's appendix C, both reserved columns): a name
 * spelled as one is quoted, as is any name not all lower case.
 */
const RESERVED = new Set(
  (
    "ALL ANALYSE ANALYZE AND ANY ARRAY AS ASC ASYMMETRIC AUTHORIZATION BINARY BOTH CASE CAST CHECK " +
    "COLLATE COLLATION COLUMN CONCURRENTLY CONSTRAINT CREATE CROSS CURRENT_CATALOG CURRENT_DATE " +
    "CURRENT_ROLE CURRENT_SCHEMA CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER DEFAULT DEFERRABLE DESC " +
    "DISTINCT DO ELSE END EXCEPT FALSE FETCH FOR FOREIGN FREEZE FROM FULL GRANT GROUP HAVING ILIKE IN " +
    "INITIALLY INNER INTERSECT INTO IS ISNULL JOIN LATERAL LEADING LEFT LIKE LIMIT LOCALTIME " +
    "LOCALTIMESTAMP NATURAL NOT NOTNULL NULL OFFSET ON ONLY OR ORDER OUTER OVERLAPS PLACING PRIMARY " +
    "REFERENCES RETURNING RIGHT SELECT SESSION_USER SIMILAR SOME SYMMETRIC SYSTEM_USER TABLE " +
    "TABLESAMPLE THEN TO TRAILING TRUE UNION UNIQUE USER USING VARIADIC VERBOSE WHEN WHERE WINDOW WITH"
  ).split(" "),
);
const name = (/** @type {string} */ schema, /** @type {string} */ relation) =>
  readableName("postgresql", schema, relation, RESERVED);
const text = (/** @type {string} */ value) => quoteText("postgresql", value);

/** The sentence for a server older than the form runs on, or "". */
export function tooOld(
  /** @type {string} */ conn,
  /** @type {number} */ version,
  /** @type {string} */ server,
) {
  return version >= FLOOR
    ? ""
    : `${conn} runs PostgreSQL ${server}: maintenance from this form needs PostgreSQL 13 or later.`;
}

/**
 * The statement a plan runs, or why it cannot run yet ("" when it can).
 * @param {Plan} plan
 * @param {Facts} facts
 * @returns {{ sql: string, problem: string }}
 */
export function statementOf(plan, facts) {
  const { target, operation: op, options: o } = plan;
  const has = (/** @type {keyof Options} */ key) => on(key, op, target, facts, o);
  const what = targetsOf(target, facts);
  if (op === "vacuum" || op === "analyze") {
    const opts = /** @type {const} */ (["full", "freeze", "verbose", "analyze", "skipLocked"])
      .filter((key) => has(key) && o[key])
      .map((key) => LABELS[key]);
    // AUTO is 14's: on 13, INDEX_CLEANUP is on or off.
    const cleanup = o.indexCleanup === "auto" && facts.version < FOURTEEN ? "" : o.indexCleanup;
    if (has("indexCleanup") && cleanup) opts.push(`INDEX_CLEANUP ${cleanup.toUpperCase()}`);
    if (has("truncate") && o.truncate) opts.push(`TRUNCATE ${o.truncate.toUpperCase()}`);
    if (has("parallel") && o.parallel !== null) opts.push(`PARALLEL ${o.parallel}`);
    if (has("processToast") && !o.processToast) opts.push("PROCESS_TOAST OFF");
    if (has("bufferUsageLimit") && o.bufferUsageLimit)
      opts.push(`BUFFER_USAGE_LIMIT ${text(o.bufferUsageLimit)}`);
    const sql = [TITLES[op], opts.length ? `(${opts.join(", ")})` : "", what.join(", ")];
    const problem =
      target.kind === "schema" && what.length === 0
        ? `Schema ${target.schema} holds no table to ${op}.`
        : target.kind === "index"
          ? `${TITLES[op]} runs on a table, a schema or the database.`
          : "";
    return { sql: sql.filter(Boolean).join(" "), problem };
  }
  if (op === "reindex") {
    const opts = [
      ...(has("verbose") && o.verbose ? ["VERBOSE"] : []),
      ...(has("tablespace") && o.tablespace ? [`TABLESPACE ${name("", o.tablespace)}`] : []),
    ];
    const kind = { database: "DATABASE", schema: "SCHEMA", table: "TABLE", index: "INDEX" }[
      target.kind
    ];
    const concurrently = has("concurrently") && o.concurrently ? "CONCURRENTLY" : "";
    const sql = ["REINDEX", opts.length ? `(${opts.join(", ")})` : "", kind, concurrently];
    return { sql: [...sql, reindexed(target, facts)].filter(Boolean).join(" "), problem: "" };
  }
  // CLUSTER: a table by an index, or every table clustered before.
  // Parenthesised options take a table before 17: CLUSTER (VERBOSE) alone is 17's.
  const paren = facts.version >= (target.kind === "database" ? SEVENTEEN : FOURTEEN);
  const options = o.verbose ? (paren ? "(VERBOSE)" : "VERBOSE") : "";
  if (target.kind === "database")
    return { sql: ["CLUSTER", options].join(" ").trim(), problem: "" };
  if (target.kind === "schema")
    return { sql: "CLUSTER", problem: "CLUSTER runs on a table or on the whole database." };
  const using = target.kind === "index" ? target.index : o.using;
  const table = name(target.schema, target.table);
  const sql = ["CLUSTER", options, table, using ? `USING ${name("", using)}` : ""];
  const problem = !using
    ? "Pick the index CLUSTER orders the table by."
    : partitionedTooOld(facts)
      ? "CLUSTER of a partitioned table needs PostgreSQL 15 or later."
      : target.kind === "index" && !facts.indexes.some((i) => i.name === using && clusterable(i))
        ? `CLUSTER cannot order a table by ${using}: it needs a valid, whole btree or GiST index.`
        : "";
  return { sql: sql.filter(Boolean).join(" "), problem };
}

/** VACUUM's and ANALYZE's tables: the table, a schema's tables, none for the database. */
function targetsOf(/** @type {Target} */ t, /** @type {Facts} */ facts) {
  if (t.kind === "table") return [name(t.schema, t.table)];
  if (t.kind === "schema") return facts.tables.map((table) => name(t.schema, table));
  return [];
}

/** What REINDEX names: the index, the table, the schema or the current database. */
function reindexed(/** @type {Target} */ t, /** @type {Facts} */ facts) {
  if (t.kind === "index") return name(t.schema, t.index);
  if (t.kind === "table") return name(t.schema, t.table);
  if (t.kind === "schema") return name("", t.schema);
  return name("", facts.database);
}

/** The server's version, the database and whether it is a standby. */
export const HEAD =
  "SELECT current_database(), current_setting('server_version_num')::int, " +
  "current_setting('server_version'), pg_catalog.pg_is_in_recovery()";
export const TABLESPACES =
  "SELECT spcname FROM pg_catalog.pg_tablespace WHERE spcname <> 'pg_global' ORDER BY spcname";

const stamp = (/** @type {string} */ column) => `to_char(${column}, 'YYYY-MM-DD HH24:MI:SS')`;
const LAST = ["last_vacuum", "last_autovacuum", "last_analyze", "last_autoanalyze"];

/** The relation a table or index target's statistics are of (its table, for an index). */
function relationOf(/** @type {Target} */ t) {
  const where = `n.nspname = ${text(t.schema)}`;
  if (t.kind === "table")
    return `(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE ${where} AND c.relname = ${text(t.table)})`;
  return `(SELECT x.indrelid FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid = i.relnamespace WHERE ${where} AND i.relname = ${text(t.index)})`;
}

/**
 * One row of the target's statistics: relkind, live rows, dead rows, bytes in all, of the table and
 * of its indexes, the four last runs, the tables counted and the table's name.
 * @param {Target} t
 */
export function statsSql(t) {
  if (t.kind === "table" || t.kind === "index") {
    const last = LAST.map((c) => stamp(`s.${c}`)).join(", ");
    return [
      "SELECT c.relkind, s.n_live_tup, s.n_dead_tup, pg_catalog.pg_total_relation_size(c.oid),",
      `pg_catalog.pg_relation_size(c.oid), pg_catalog.pg_indexes_size(c.oid), ${last}, 1, c.relname`,
      "FROM pg_catalog.pg_class c LEFT JOIN pg_catalog.pg_stat_all_tables s ON s.relid = c.oid",
      `WHERE c.oid = ${relationOf(t)}`,
    ].join(" ");
  }
  const last = LAST.map((c) => stamp(`max(s.${c})`)).join(", ");
  if (t.kind === "schema")
    return [
      "SELECT NULL, sum(s.n_live_tup), sum(s.n_dead_tup), sum(pg_catalog.pg_total_relation_size(c.oid)),",
      `sum(pg_catalog.pg_relation_size(c.oid)), sum(pg_catalog.pg_indexes_size(c.oid)), ${last}, count(c.oid), NULL`,
      "FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace",
      "LEFT JOIN pg_catalog.pg_stat_all_tables s ON s.relid = c.oid",
      `WHERE n.nspname = ${text(t.schema)} AND c.relkind IN ('r', 'm', 'p')`,
    ].join(" ");
  return [
    "SELECT NULL, sum(s.n_live_tup), sum(s.n_dead_tup), pg_catalog.pg_database_size(current_database()),",
    `NULL, NULL, ${last}, count(s.relid), NULL FROM pg_catalog.pg_stat_user_tables s`,
  ].join(" ");
}

/** The indexes of a table target's table (an index target's table): name, kind and size. */
export function indexesSql(/** @type {Target} */ t) {
  return [
    "SELECT i.relname, x.indisclustered, x.indisprimary, x.indisvalid, a.amname,",
    "x.indpred IS NOT NULL, pg_catalog.pg_relation_size(i.oid)",
    "FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid",
    "JOIN pg_catalog.pg_am a ON a.oid = i.relam",
    `WHERE x.indrelid = ${relationOf(t)} ORDER BY i.relname`,
  ].join(" ");
}

/** A schema's tables VACUUM and ANALYZE name: tables, materialized views, partitioned parents. */
export const tablesSql = (/** @type {string} */ schema) =>
  "SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
  `WHERE n.nspname = ${text(schema)} AND c.relkind IN ('r', 'm', 'p') AND NOT c.relispartition ORDER BY c.relname`;

/** What is read when the form opens or is read again, in this order. */
export function factsSql(/** @type {Target} */ t) {
  return [LOCK_TIMEOUT, HEAD, TABLESPACES, ...statsQueries(t).slice(1)].concat(
    t.kind === "schema" ? [tablesSql(t.schema)] : [],
  );
}

/** What is read after a run: the statistics, and the indexes of a table or an index. */
export function statsQueries(/** @type {Target} */ t) {
  return [
    LOCK_TIMEOUT,
    statsSql(t),
    ...(t.kind === "table" || t.kind === "index" ? [indexesSql(t)] : []),
  ];
}

/** The run's own session: the plugin's, this sign-in's, this database's, running this statement. Its
 * application name and sign-in are this session's own, so a connection's own application name or
 * role (PG-12) finds it too. */
const own = (/** @type {string} */ sql) =>
  [
    "a.application_name = pg_catalog.current_setting('application_name') AND a.usename = session_user",
    "AND a.datname = current_database() AND a.pid <> pg_catalog.pg_backend_pid()",
    `AND a.state = 'active' AND a.query <> '' AND starts_with(${text(sql)}, a.query)`,
  ].join(" ");

/** The run's session with its wait, who blocks it, how long it runs and each progress view. */
export function progressSql(/** @type {string} */ sql) {
  const rel = (/** @type {string} */ c) => `${c}::regclass::text`;
  return [
    "SELECT a.pid, a.wait_event_type, a.wait_event,",
    "array_to_string(pg_catalog.pg_blocking_pids(a.pid), ' '),",
    "(extract(epoch FROM now() - a.query_start) * 1000)::bigint,",
    `v.phase, v.heap_blks_scanned, v.heap_blks_total, ${rel("v.relid")},`,
    `c.command, c.phase, c.heap_blks_scanned, c.heap_blks_total, ${rel("c.relid")},`,
    `i.command, i.phase, i.blocks_done, i.blocks_total, ${rel("i.index_relid")},`,
    `z.phase, z.sample_blks_scanned, z.sample_blks_total, ${rel("z.relid")}`,
    "FROM pg_catalog.pg_stat_activity a",
    "LEFT JOIN pg_catalog.pg_stat_progress_vacuum v ON v.pid = a.pid",
    "LEFT JOIN pg_catalog.pg_stat_progress_cluster c ON c.pid = a.pid",
    "LEFT JOIN pg_catalog.pg_stat_progress_create_index i ON i.pid = a.pid",
    "LEFT JOIN pg_catalog.pg_stat_progress_analyze z ON z.pid = a.pid",
    `WHERE ${own(sql)} ORDER BY a.pid`,
  ].join(" ");
}

/** Cancel the run's statement on the server: its session stays, other runs go on. */
export const cancelSql = (/** @type {string} */ sql) =>
  `SELECT pg_catalog.pg_cancel_backend(a.pid) FROM pg_catalog.pg_stat_activity a WHERE ${own(sql)}`;
