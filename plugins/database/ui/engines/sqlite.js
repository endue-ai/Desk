// SQLite through sqlite3. `-safe` turns off what could reach past the database (.shell, .system,
// .load, .output, ATTACH, load_extension(), readfile() and writefile()), `-bail` ends the run at the
// first error, `-readonly` opens a read-only connection's file read-only. Each statement is its own
// argument after `.mode quote` and `.headers on`, followed by a SELECT of total_changes() named by a
// random marker: the marker says where the statement's output ends, the difference between two
// totals is how many rows it changed. Quote mode prints every value as an SQL literal, so NULL,
// numbers, text and blobs stay what they are. A statement starting with `.` is refused before.
// Reading what sqlite3 printed is the result worker's (ui/output/sqlite.js, #38).

import { quoteText } from "../sql/quote.js";
import { lineCounter, markOf } from "./text.js";

/**
 * @typedef {import("./common.js").Connection} Connection
 * @typedef {import("./common.js").PlanOptions} PlanOptions
 * @typedef {import("./common.js").Invocation} Invocation
 */

/** The file argument: `~/` is resolved by starting in the home folder, which the core does. */
export function fileArg(/** @type {string} */ file) {
  if (file.startsWith("~/")) return `./${file.slice(2)}`;
  return file;
}

/**
 * @param {Connection} conn
 * @param {PlanOptions} options
 * @returns {Invocation}
 */
function plan(conn, options) {
  const { statements, maxRows, mode, nonce, single } = options;
  const mark = markOf(nonce);
  const args = ["-safe", "-batch", "-bail", ...(conn.readOnly ? ["-readonly"] : [])];
  args.push(fileArg(conn.file), ".mode quote", ".headers on", ".timeout 5000");
  if (mode !== "run") args.push("BEGIN");
  statements.forEach((statement, index) => {
    args.push(statement.text, `SELECT total_changes() AS "${mark}${index}"`);
  });
  if (mode === "transaction") args.push("COMMIT");
  if (mode === "dry-run") args.push("ROLLBACK");
  return {
    command: "sqlite3",
    args,
    env: {},
    nonce,
    statements,
    maxRows,
    stopAfter: single ? maxRows + 2 : 0,
    counter: lineCounter("'"),
  };
}

export const sqlite = {
  id: /** @type {const} */ ("sqlite"),
  title: "SQLite",
  dialect: /** @type {const} */ ("sqlite"),
  port: null,
  client: "sqlite3",
  plan,
  versionSql: "SELECT sqlite_version()",
  explain: (/** @type {string} */ text) => `EXPLAIN QUERY PLAN ${text}`,
  catalog: {
    schemas: () => "SELECT 'main'",
    columns: (/** @type {string} */ _schema, /** @type {string} */ table) =>
      "SELECT name, type, CASE \"notnull\" WHEN 0 THEN 'YES' ELSE 'NO' END, dflt_value, " +
      `CASE WHEN pk > 0 THEN 'YES' ELSE 'NO' END FROM pragma_table_info(${quoteText("sqlite", table)}) ORDER BY cid`,
  },
  /** DDL takes part in a transaction, so a dry run can hold it. */
  ddlCommits: false,
};
