// What sqlite3 printed, read in the result worker (ui/output-worker.js, #38): its quote-mode records,
// each statement's ended by the marker SELECT of total_changes() (ui/engines/sqlite.js), and the
// error sqlite3 wrote. Imports only relative files.

import { endedBy, failedRun, linesOf, notRun, resultSet } from "../engines/common.js";
import { markOf } from "../engines/text.js";
import { readQuoted } from "./readers.js";

/**
 * @typedef {import("../engines/common.js").Invocation} Invocation
 * @typedef {import("../engines/common.js").Outcome} Outcome
 * @typedef {import("../engines/common.js").RunResult} RunResult
 * @typedef {import("../engines/common.js").StatementOutcome} StatementOutcome
 * @typedef {import("../engines/common.js").DbError} DbError
 */

/**
 * @param {Outcome} outcome
 * @param {Invocation} invocation
 * @param {number} timeoutMs
 * @returns {RunResult}
 */
export function readSqlite(outcome, invocation, timeoutMs) {
  const { statements, nonce, maxRows } = invocation;
  const mark = markOf(nonce);
  const partial = outcome.stopped || outcome.code !== 0;
  const records = readQuoted(outcome.stdout, partial);
  /** @type {Map<number, { sets: import("../engines/common.js").ResultSet[], affected: number }>} */
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
