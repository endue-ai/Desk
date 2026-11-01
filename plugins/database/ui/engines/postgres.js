// PostgreSQL through psql. Every statement is its own `-c`, which psql sends to the server as it is:
// no meta-command (`\!`, `\o`, `\copy`) and no variable is read from it, and a statement that starts
// with a backslash is refused before. After each one, `\echo` and `\warn` print a marker line with
// the row count on standard output and error, so output and notices belong to their statement.
// `--csv` with a random NULL text keeps NULL apart from ''. ON_ERROR_STOP ends the run at the first
// error, whose words are what psql printed after the last marker. Connection values go through PG*
// environment variables, never as options, so no value can become one.

import { quoteText } from "../sql/quote.js";
import {
  authFailed,
  endedBy,
  env,
  failedRun,
  linesOf,
  notRun,
  offsetIn,
  resultSet,
} from "./common.js";
import { escapeRegExp, lineCounter, readCsv, segments } from "./text.js";

/**
 * @typedef {import("./common.js").Connection} Connection
 * @typedef {import("./common.js").PlanOptions} PlanOptions
 * @typedef {import("./common.js").Invocation} Invocation
 * @typedef {import("./common.js").Outcome} Outcome
 * @typedef {import("./common.js").RunResult} RunResult
 * @typedef {import("./common.js").StatementOutcome} StatementOutcome
 * @typedef {import("./common.js").DbError} DbError
 * @typedef {import("./common.js").ResultSet} ResultSet
 */

const markOf = (/** @type {string} */ nonce) => `@@endue:${nonce}:`;
const nullOf = (/** @type {string} */ nonce) => `@@null:${nonce}`;

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

/**
 * @param {Outcome} outcome
 * @param {Invocation} invocation
 * @param {number} timeoutMs
 * @returns {RunResult}
 */
function parse(outcome, invocation, timeoutMs) {
  const { statements, nonce, maxRows } = invocation;
  const mark = escapeRegExp(markOf(nonce));
  const out = segments(outcome.stdout, new RegExp(`^${mark}(\\d+) ?(\\d*)$`, "gmu"));
  const err = segments(outcome.stderr, new RegExp(`^${mark}(\\d+)$`, "gmu"));
  const nothing = out.before.size === 0 && err.before.size === 0;
  if (nothing && !outcome.stopped && /^psql: error:/mu.test(outcome.stderr)) {
    return failedRun(statements, connectError(outcome.stderr), outcome.ms);
  }
  const ended = endedBy(outcome, timeoutMs);
  const missing = statements.findIndex((_, index) => !out.before.has(index));
  /** @type {StatementOutcome[]} */
  const results = statements.map((statement, index) => {
    const done = out.before.get(index);
    const notices = linesOf(err.before.get(index)?.text ?? "");
    if (done) {
      const sets = csvSets(done.text, nonce, maxRows, false);
      const count = done.fields[0] ? Number(done.fields[0]) : null;
      return { index, ran: true, sets, affected: sets.length ? null : count, warnings: 0, notices };
    }
    if (index !== missing) return notRun(index);
    const sets = csvSets(out.rest, nonce, maxRows, true, outcome.stopped);
    const tail = linesOf(err.rest);
    if (outcome.stopped)
      return { index, ran: true, sets, affected: null, warnings: 0, notices: tail };
    const error = ended ?? sqlError(err.rest, statement.text);
    return { index, ran: true, sets, affected: null, warnings: 0, notices: [], error };
  });
  return { statements: results, notices: [], ms: outcome.ms };
}

/** The result set in psql's CSV for one statement: a header line, then rows. */
function csvSets(
  /** @type {string} */ text,
  /** @type {string} */ nonce,
  /** @type {number} */ maxRows,
  /** @type {boolean} */ partial,
  stopped = false,
) {
  if (text === "") return [];
  const [header, ...rows] = readCsv(text, partial);
  if (!header) return [];
  const none = nullOf(nonce);
  const values = rows.map((row) => row.map((value) => (value === none ? null : value)));
  return [resultSet(header, values, maxRows, stopped)];
}

/** psql could not connect: its message without `psql: error:`, auth failures marked. */
function connectError(/** @type {string} */ stderr) {
  const lines = linesOf(stderr).map((line) => line.replace(/^psql: error: /u, ""));
  const message = lines.join(" ").replace(/\s+/gu, " ").trim();
  return /** @type {DbError} */ ({ kind: authFailed(stderr) ? "auth" : "connect", message });
}

/**
 * The error psql printed for a statement: the severity line's message, the lines after it (DETAIL,
 * HINT, CONTEXT) as detail, and LINE n with its caret as a position in the statement.
 * @param {string} stderr
 * @param {string} text
 * @returns {DbError}
 */
export function sqlError(stderr, text) {
  const lines = linesOf(stderr).filter((line) => !/^(NOTICE|WARNING|INFO|LOG|DEBUG):/u.test(line));
  const at = lines.findIndex((line) => /^[A-Z]+:\s\s/u.test(line));
  const head = at >= 0 ? (lines[at] ?? "") : (lines[0] ?? "psql ended without saying why.");
  const message = head.replace(/^[A-Z]+:\s+/u, "");
  const rest = lines.slice(at + 1);
  const lineAt = rest.findIndex((line) => /^LINE \d+: /u.test(line));
  const position =
    lineAt >= 0 ? caretOffset(rest[lineAt] ?? "", rest[lineAt + 1] ?? "", text) : undefined;
  const detail = rest.filter((_line, i) => i !== lineAt && i !== lineAt + 1).join("\n");
  return {
    kind: authFailed(head) ? "auth" : "sql",
    message,
    ...(detail ? { detail } : {}),
    ...(position !== undefined ? { position } : {}),
  };
}

/** Where libpq's caret points, as an offset in the statement (`...` marks a cut line). */
function caretOffset(
  /** @type {string} */ context,
  /** @type {string} */ caret,
  /** @type {string} */ text,
) {
  const match = /^LINE (\d+): (.*)$/u.exec(context);
  if (!match || !caret.includes("^")) return undefined;
  const line = Number(match[1]);
  const prefix = context.length - (match[2] ?? "").length;
  let shown = match[2] ?? "";
  let column = caret.indexOf("^") - prefix;
  if (shown.startsWith("...")) {
    shown = shown.slice(3).replace(/\.\.\.$/u, "");
    const source = text.split("\n")[line - 1] ?? "";
    const found = source.indexOf(shown);
    if (found < 0) return undefined;
    column = found + column - 3;
  }
  return offsetIn(text, line, column + 1);
}

export const postgres = {
  id: /** @type {const} */ ("postgresql"),
  title: "PostgreSQL",
  dialect: /** @type {const} */ ("postgresql"),
  port: 5432,
  client: "psql",
  plan,
  parse,
  versionSql: "SELECT version()",
  explain: (/** @type {string} */ text) => `EXPLAIN ${text}`,
  catalog: {
    schemas: (/** @type {boolean} */ system) =>
      `SELECT nspname FROM pg_catalog.pg_namespace${
        system ? "" : " WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'"
      } ORDER BY nspname`,
    tables: (/** @type {string} */ schema) =>
      "SELECT c.relname, CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' " +
      "WHEN 'f' THEN 'foreign table' ELSE 'table' END FROM pg_catalog.pg_class c " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      `WHERE n.nspname = ${quoteText("postgresql", schema)} ` +
      "AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition ORDER BY c.relname",
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
