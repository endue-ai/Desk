// MySQL and MariaDB through the mysql (or mariadb) client. The script goes in one `-e` with a random
// DELIMITER, so a statement's own `;` (a procedure body) stays inside it. `--binary-mode` turns the
// client's commands off (`\!`, `system`, `source`, `tee`), `--local-infile=0` keeps LOAD DATA LOCAL
// from reading the person's files, `--skip-reconnect` keeps a dropped connection from carrying on
// without the session. After each statement a SELECT of ROW_COUNT() and @@warning_count, named by a
// random marker, says where its output ends; `--xml` keeps NULL apart from '' and 'NULL', and
// `--binary-as-hex` prints bytes as 0x... The first error ends the run (the client stops there).
// Reading what the client printed is the result worker's (ui/output/mysql.js, #38).

import { quoteText } from "../sql/quote.js";
import { env } from "./common.js";
import { markOf, rowCounter } from "./text.js";

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
  versionSql: "SELECT VERSION()",
  explain: (/** @type {string} */ text) => `EXPLAIN ${text}`,
  catalog: {
    schemas: (/** @type {boolean} */ system) =>
      `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA${userSchemas("SCHEMA_NAME", system)} ORDER BY SCHEMA_NAME`,
    columns: (/** @type {string} */ schema, /** @type {string} */ table) =>
      "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, " +
      "CASE COLUMN_KEY WHEN 'PRI' THEN 'YES' ELSE 'NO' END FROM information_schema.COLUMNS " +
      `WHERE TABLE_SCHEMA = ${quoteText("mysql", schema)} AND TABLE_NAME = ${quoteText("mysql", table)} ` +
      "ORDER BY ORDINAL_POSITION",
  },
  /** DDL commits on its own, so a dry run cannot hold it. */
  ddlCommits: true,
};
