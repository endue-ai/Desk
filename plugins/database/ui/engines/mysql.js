// MySQL and MariaDB through the mysql (or mariadb) client. The script goes in one `-e` with a random
// DELIMITER, so a statement's own `;` (a procedure body) stays inside it. `--binary-mode` turns the
// client's commands off (`\!`, `system`, `source`, `tee`), `--local-infile=0` keeps LOAD DATA LOCAL
// from reading the person's files, `--skip-reconnect` keeps a dropped connection from carrying on
// without the session. After each statement a SELECT of ROW_COUNT() and @@warning_count, named by a
// random marker, says where its output ends; `--xml` keeps NULL apart from '' and 'NULL', and
// `--binary-as-hex` prints bytes as 0x... The first error ends the run (the client stops there).

import { quoteText } from "../sql/quote.js";
import { authFailed, endedBy, env, failedRun, notRun, offsetIn, resultSet } from "./common.js";
import { readMysqlXml } from "./readers.js";
import { rowCounter } from "./text.js";

/**
 * @typedef {import("./common.js").Connection} Connection
 * @typedef {import("./common.js").PlanOptions} PlanOptions
 * @typedef {import("./common.js").Invocation} Invocation
 * @typedef {import("./common.js").Outcome} Outcome
 * @typedef {import("./common.js").RunResult} RunResult
 * @typedef {import("./common.js").StatementOutcome} StatementOutcome
 * @typedef {import("./common.js").DbError} DbError
 */

const markOf = (/** @type {string} */ nonce) => `@@endue:${nonce}:`;
/** Client errors that mean the connection never stood: cannot connect, unknown host, TLS, auth. */
const CONNECT_CODES = new Set([
  "1044",
  "1045",
  "1698",
  "2002",
  "2003",
  "2005",
  "2006",
  "2013",
  "2026",
  "2059",
  "2061",
]);

/**
 * @param {Connection} conn
 * @param {PlanOptions} options
 * @returns {Invocation}
 */
function plan(conn, options) {
  const { statements, maxRows, password, mode, nonce, single, flavor } = options;
  // The client keeps at most 15 characters of a delimiter (mysql.cc: char delimiter[16]).
  const delimiter = `;;${nonce.slice(0, 11)};;`;
  const mark = markOf(nonce);
  const lines = [
    `DELIMITER ${delimiter}`,
    `SET SESSION sql_select_limit = ${maxRows + 1} ${delimiter}`,
  ];
  if (conn.readOnly) lines.push(`SET SESSION TRANSACTION READ ONLY ${delimiter}`);
  if (mode !== "run") lines.push(`START TRANSACTION ${delimiter}`);
  statements.forEach((statement, index) => {
    lines.push(`${statement.text}\n${delimiter}`);
    lines.push(`SELECT ROW_COUNT() AS \`${mark}${index}\`, @@warning_count AS w ${delimiter}`);
  });
  if (mode === "transaction") lines.push(`COMMIT ${delimiter}`);
  if (mode === "dry-run") lines.push(`ROLLBACK ${delimiter}`);
  const args = [
    "--batch",
    "--xml",
    "--binary-as-hex",
    "--binary-mode",
    "--local-infile=0",
    "--skip-reconnect",
    "--comments",
    "--default-character-set=utf8mb4",
    "--connect-timeout=10",
    ...(conn.host ? [`--host=${conn.host}`, "--protocol=TCP"] : []),
    ...(conn.port ? [`--port=${conn.port}`] : []),
    ...(conn.user ? [`--user=${conn.user}`] : []),
    ...(conn.database ? [`--database=${conn.database}`] : []),
    ...sslArgs(conn, flavor ?? "mysql"),
    "-e",
    lines.join("\n"),
  ];
  return {
    command: "mysql",
    args,
    env: env({ MYSQL_PWD: password }),
    nonce,
    statements,
    maxRows,
    stopAfter: single ? maxRows + 1 : 0,
    counter: rowCounter(),
  };
}

/** TLS options: MySQL's --ssl-mode, or MariaDB's --ssl and --ssl-verify-server-cert. */
export function sslArgs(/** @type {Connection} */ conn, /** @type {"mysql" | "mariadb"} */ flavor) {
  const ca = conn.sslCa ? [`--ssl-ca=${conn.sslCa}`] : [];
  if (flavor === "mariadb") {
    if (conn.ssl === "disable") return ["--skip-ssl"];
    if (conn.ssl === "require") return ["--ssl", "--skip-ssl-verify-server-cert", ...ca];
    if (conn.ssl === "verify-ca" || conn.ssl === "verify-full")
      return ["--ssl", "--ssl-verify-server-cert", ...ca];
    return ca;
  }
  const mode = /** @type {Record<string, string>} */ ({
    disable: "DISABLED",
    prefer: "PREFERRED",
    require: "REQUIRED",
    "verify-ca": "VERIFY_CA",
    "verify-full": "VERIFY_IDENTITY",
  })[conn.ssl];
  return [...(mode ? [`--ssl-mode=${mode}`] : []), ...ca];
}

/**
 * @param {Outcome} outcome
 * @param {Invocation} invocation
 * @param {number} timeoutMs
 * @returns {RunResult}
 */
function parse(outcome, invocation, timeoutMs) {
  const { statements, nonce, maxRows } = invocation;
  const mark = markOf(nonce);
  /** @type {Map<number, { sets: import("./common.js").ResultSet[], affected: number, warnings: number }>} */
  const done = new Map();
  /** @type {import("./common.js").ResultSet[]} */
  let pending = [];
  for (const { table, closed } of readMysqlXml(outcome.stdout)) {
    const name = table.columns[0] ?? "";
    if (name.startsWith(mark) && closed) {
      const [count, warnings] = table.rows[0] ?? [];
      done.set(Number(name.slice(mark.length)), {
        sets: pending,
        affected: Number(count ?? -1),
        warnings: Number(warnings ?? 0),
      });
      pending = [];
    } else pending.push(resultSet(table.columns, table.rows, maxRows, outcome.stopped || !closed));
  }
  const errors = clientErrors(outcome.stderr);
  const first = errors[0];
  if (done.size === 0 && !outcome.stopped && first?.code && CONNECT_CODES.has(first.code)) {
    const kind = authFailed(first.raw) ? "auth" : "connect";
    return failedRun(statements, { kind, message: first.message, code: first.code }, outcome.ms);
  }
  const ended = endedBy(outcome, timeoutMs);
  const missing = statements.findIndex((_, index) => !done.has(index));
  /** @type {StatementOutcome[]} */
  const results = statements.map((statement, index) => {
    const finished = done.get(index);
    if (finished) {
      const { sets, affected, warnings } = finished;
      return {
        index,
        ran: true,
        sets,
        affected: affected >= 0 ? affected : null,
        warnings,
        notices: [],
      };
    }
    if (index !== missing) return notRun(index);
    if (outcome.stopped)
      return { index, ran: true, sets: pending, affected: null, warnings: 0, notices: [] };
    const error = ended ?? statementError(first, statement.text);
    return { index, ran: true, sets: pending, affected: null, warnings: 0, notices: [], error };
  });
  return { statements: results, notices: [], ms: outcome.ms };
}

/**
 * The client's error lines: `ERROR 1064 (42000) at line 3: message`, `ERROR 2002 (HY000): message`
 * or a client-side `ERROR at line 1: Unknown command '\!'.`
 * @param {string} stderr
 */
export function clientErrors(stderr) {
  const errors = [];
  for (const match of stderr.matchAll(
    /^ERROR(?: (\d+) \(([0-9A-Z]{5})\))?(?: at line (\d+))?: ([^\n]*)$/gmu,
  )) {
    errors.push({
      code: match[1] ?? "",
      state: match[2] ?? "",
      message: (match[4] ?? "").trim(),
      raw: match[0],
    });
  }
  return errors;
}

/**
 * A statement's error, with the position MySQL names (`near '...' at line n`) as an offset.
 * @param {ReturnType<typeof clientErrors>[number] | undefined} error
 * @param {string} text
 * @returns {DbError}
 */
function statementError(error, text) {
  if (!error) return { kind: "client", message: "The client ended without saying why." };
  const near = /near '([\s\S]*)' at line (\d+)$/u.exec(error.message);
  let position;
  if (near) {
    const line = Number(near[2]);
    const start = offsetIn(text, line, 1) ?? 0;
    const found = text.indexOf((near[1] ?? "").slice(0, 40), start);
    if (found >= 0) position = found;
  }
  return {
    kind: !error.code ? "client" : authFailed(error.raw) ? "auth" : "sql",
    message: error.message,
    ...(error.code ? { code: `${error.code}${error.state ? ` (${error.state})` : ""}` } : {}),
    ...(position !== undefined ? { position } : {}),
  };
}

/** A schema filter: the system schemas only when asked for. */
const userSchemas = (/** @type {string} */ column, /** @type {boolean} */ system) =>
  system
    ? ""
    : ` WHERE ${column} NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')`;

export const mysql = {
  id: /** @type {const} */ ("mysql"),
  title: "MySQL / MariaDB",
  dialect: /** @type {const} */ ("mysql"),
  port: 3306,
  client: "mysql",
  plan,
  parse,
  versionSql: "SELECT VERSION()",
  explain: (/** @type {string} */ text) => `EXPLAIN ${text}`,
  catalog: {
    schemas: (/** @type {boolean} */ system) =>
      `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA${userSchemas("SCHEMA_NAME", system)} ORDER BY SCHEMA_NAME`,
    tables: (/** @type {string} */ schema) =>
      "SELECT TABLE_NAME, CASE TABLE_TYPE WHEN 'VIEW' THEN 'view' WHEN 'SYSTEM VIEW' THEN 'view' " +
      "ELSE 'table' END FROM information_schema.TABLES " +
      `WHERE TABLE_SCHEMA = ${quoteText("mysql", schema)} ORDER BY TABLE_NAME`,
    columns: (/** @type {string} */ schema, /** @type {string} */ table) =>
      "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, " +
      "CASE COLUMN_KEY WHEN 'PRI' THEN 'YES' ELSE 'NO' END FROM information_schema.COLUMNS " +
      `WHERE TABLE_SCHEMA = ${quoteText("mysql", schema)} AND TABLE_NAME = ${quoteText("mysql", table)} ` +
      "ORDER BY ORDINAL_POSITION",
  },
  /** DDL commits on its own, so a dry run cannot hold it. */
  ddlCommits: true,
};
