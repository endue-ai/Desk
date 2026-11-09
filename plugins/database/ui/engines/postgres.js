// PostgreSQL through psql. Every statement is its own `-c`, which psql sends to the server as it is:
// no meta-command (`\!`, `\o`, `\copy`) and no variable is read from it, and a statement that starts
// with a backslash is refused before. After each one, `\echo` and `\warn` print a marker line with
// the row count on standard output and error, so output and notices belong to their statement.
// `--csv` with a random NULL text keeps NULL apart from ''. ON_ERROR_STOP ends the run at the first
// error, whose words are what psql printed after the last marker. Connection values go through PG*
// environment variables, never as options, so no value can become one. Reading what psql printed is
// the result worker's (ui/output/postgres.js, #38).

import { quoteText } from "../sql/quote.js";
import { env } from "./common.js";
import { lineCounter, markOf, nullOf } from "./text.js";

/**
 * @typedef {import("./common.js").Connection} Connection
 * @typedef {import("./common.js").PlanOptions} PlanOptions
 * @typedef {import("./common.js").Invocation} Invocation
 */

/**
 * @param {Connection} conn
 * @param {PlanOptions} options
 * @returns {Invocation}
 */
function plan(conn, options) {
  const { statements, maxRows, timeoutMs, password, mode, nonce, single } = options;
  const mark = markOf(nonce);
  const args = [
    "-X",
    "-w",
    "-q",
    "--csv",
    "-P",
    `null=${nullOf(nonce)}`,
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    `FETCH_COUNT=${single ? maxRows + 1 : Math.min(1000, maxRows + 1)}`,
  ];
  if (mode === "transaction") args.push("--single-transaction");
  if (mode === "dry-run") args.push("-c", "BEGIN");
  statements.forEach((statement, index) => {
    args.push("-c", statement.text);
    args.push("-c", `\\echo ${mark}${index} :ROW_COUNT`, "-c", `\\warn ${mark}${index}`);
  });
  if (mode === "dry-run") args.push("-c", "ROLLBACK");
  const settings = [
    timeoutMs > 0 ? `-c statement_timeout=${timeoutMs}` : "",
    conn.readOnly ? "-c default_transaction_read_only=on" : "",
  ].filter(Boolean);
  return {
    command: "psql",
    args,
    env: env({
      PGHOST: conn.host,
      PGPORT: conn.port ? String(conn.port) : "",
      PGDATABASE: conn.database,
      PGUSER: conn.user,
      PGPASSWORD: password,
      PGSSLMODE: conn.ssl === "default" ? "" : conn.ssl,
      PGSSLROOTCERT: conn.sslCa,
      PGCONNECT_TIMEOUT: "10",
      PGAPPNAME: "endue Desk",
      PGCLIENTENCODING: "UTF8",
      PGDATESTYLE: "ISO",
      PGOPTIONS: settings.join(" "),
      LC_ALL: "C",
    }),
    nonce,
    statements,
    maxRows,
    stopAfter: single ? maxRows + 2 : 0,
    counter: lineCounter('"'),
  };
}

export const postgres = {
  id: /** @type {const} */ ("postgresql"),
  title: "PostgreSQL",
  dialect: /** @type {const} */ ("postgresql"),
  port: 5432,
  client: "psql",
  plan,
  versionSql: "SELECT version()",
  explain: (/** @type {string} */ text) => `EXPLAIN ${text}`,
  catalog: {
    schemas: (/** @type {boolean} */ system) =>
      `SELECT nspname FROM pg_catalog.pg_namespace${
        system ? "" : " WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'"
      } ORDER BY nspname`,
    columns: (/** @type {string} */ schema, /** @type {string} */ table) =>
      "SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), " +
      "CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, pg_catalog.pg_get_expr(d.adbin, d.adrelid), " +
      "CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid = c.oid " +
      "AND i.indisprimary AND a.attnum = ANY (i.indkey)) THEN 'YES' ELSE 'NO' END " +
      "FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      "LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum " +
      `WHERE n.nspname = ${quoteText("postgresql", schema)} ` +
      `AND c.relname = ${quoteText("postgresql", table)} ` +
      "AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
  },
  /** DDL takes part in a transaction, so a dry run can hold it. */
  ddlCommits: false,
};
