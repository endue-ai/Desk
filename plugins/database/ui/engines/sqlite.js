// SQLite through sqlite3. `-safe` turns off what could reach past the database (.shell, .system,
// .load, .output, ATTACH, load_extension(), readfile() and writefile()), `-bail` ends the run at the
// first error, `-readonly` opens a read-only connection's file read-only. Each statement is its own
// argument after `.mode quote` and `.headers on`, followed by a SELECT of total_changes() named by a
// random marker: the marker says where the statement's output ends, the difference between two
// totals is how many rows it changed. Quote mode prints every value as an SQL literal, so NULL,
// numbers, text and blobs stay what they are. A statement starting with `.` is refused before.

import { quoteText } from "../sql/quote.js";
import { endedBy, failedRun, linesOf, notRun, resultSet } from "./common.js";
import { readQuoted } from "./readers.js";
import { lineCounter } from "./text.js";

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

/**
 * @param {Outcome} outcome
 * @param {Invocation} invocation
 * @param {number} timeoutMs
 * @returns {RunResult}
 */
function parse(outcome, invocation, timeoutMs) {
  const { statements, nonce, maxRows } = invocation;
  const mark = markOf(nonce);
  const partial = outcome.stopped || outcome.code !== 0;
  const records = readQuoted(outcome.stdout, partial);
  /** @type {Map<number, { sets: import("./common.js").ResultSet[], affected: number }>} */
  const done = new Map();
  /** @type {(string | null)[][]} */
  let pending = [];
  let total = 0;
  for (let i = 0; i < records.length; i++) {
    const record = /** @type {(string | null)[]} */ (records[i]);
    const name = record.length === 1 ? record[0] : null;
    if (typeof name === "string" && name.startsWith(mark) && i + 1 < records.length) {
      const now = Number(records[i + 1]?.[0] ?? total);
      const [header, ...rows] = pending;
      const sets = header ? [resultSet(header.map(String), rows, maxRows)] : [];
      done.set(Number(name.slice(mark.length)), { sets, affected: now - total });
      total = now;
      pending = [];
      i++;
    } else pending.push(record);
  }
  if (done.size === 0 && !outcome.stopped && /unable to open database/u.test(outcome.stderr)) {
    return failedRun(
      statements,
      { kind: "connect", message: sqliteError(outcome.stderr).message },
      outcome.ms,
    );
  }
  const ended = endedBy(outcome, timeoutMs);
  const missing = statements.findIndex((_, index) => !done.has(index));
  /** @type {StatementOutcome[]} */
  const results = statements.map((statement, index) => {
    const finished = done.get(index);
    if (finished) {
      const { sets, affected } = finished;
      return {
        index,
        ran: true,
        sets,
        affected: sets.length ? null : affected,
        warnings: 0,
        notices: [],
      };
    }
    if (index !== missing) return notRun(index);
    const [header, ...rows] = pending;
    const sets = header ? [resultSet(header.map(String), rows, maxRows, outcome.stopped)] : [];
    if (outcome.stopped)
      return { index, ran: true, sets, affected: null, warnings: 0, notices: [] };
    const error = ended ?? sqliteError(outcome.stderr, statement.text);
    return { index, ran: true, sets, affected: null, warnings: 0, notices: [], error };
  });
  return { statements: results, notices: [], ms: outcome.ms };
}

/**
 * sqlite3's error: `Error: in prepare, near "x": syntax error` (or `Runtime error: ...`,
 * `Parse error: ...`), a context line and a `^--- error here` caret under it.
 * @param {string} stderr
 * @param {string} [text]
 * @returns {DbError}
 */
export function sqliteError(stderr, text = "") {
  const lines = linesOf(stderr);
  const head =
    lines.find((line) => /error/iu.test(line)) ?? lines[0] ?? "sqlite3 ended without saying why.";
  const message = head
    .replace(/^(?:Error|Runtime error|Parse error)(?: near line \d+)?: /u, "")
    .replace(/^(?:in prepare|stepping), /u, "");
  const code = /\((\d+)\)$/u.exec(message)?.[1];
  const caretAt = lines.findIndex((line) => /\^--- error here/u.test(line));
  let position;
  if (caretAt > 0 && text) {
    const context = lines[caretAt - 1] ?? "";
    const indent = context.length - context.trimStart().length;
    const found = text.indexOf(context.trim().replace(/^\.\.\./u, ""));
    const column = (lines[caretAt] ?? "").indexOf("^") - indent;
    if (found >= 0 && column >= 0) position = found + column;
  }
  return {
    kind: "sql",
    message: code ? message.replace(/\s*\(\d+\)$/u, "") : message,
    ...(code ? { code } : {}),
    ...(position !== undefined ? { position } : {}),
  };
}

export const sqlite = {
  id: /** @type {const} */ ("sqlite"),
  title: "SQLite",
  dialect: /** @type {const} */ ("sqlite"),
  port: null,
  client: "sqlite3",
  plan,
  parse,
  versionSql: "SELECT sqlite_version()",
  explain: (/** @type {string} */ text) => `EXPLAIN QUERY PLAN ${text}`,
  catalog: {
    schemas: () => "SELECT 'main'",
    tables: () =>
      "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') " +
      "AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
    columns: (/** @type {string} */ _schema, /** @type {string} */ table) =>
      "SELECT name, type, CASE \"notnull\" WHEN 0 THEN 'YES' ELSE 'NO' END, dflt_value, " +
      `CASE WHEN pk > 0 THEN 'YES' ELSE 'NO' END FROM pragma_table_info(${quoteText("sqlite", table)}) ORDER BY cid`,
  },
  /** DDL takes part in a transaction, so a dry run can hold it. */
  ddlCommits: false,
};
