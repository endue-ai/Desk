// What the mysql (or mariadb) client printed, read in the result worker (ui/output-worker.js, #38):
// its `--xml` result sets, each statement's ended by the marker SELECT (ui/engines/mysql.js), and the
// client's error lines. Imports only relative files.

import { authFailed, endedBy, failedRun, notRun, offsetIn, resultSet } from "../engines/common.js";
import { markOf } from "../engines/text.js";
import { readMysqlXml } from "./readers.js";

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
export function readMysql(outcome, invocation, timeoutMs) {
  const { statements, nonce, maxRows } = invocation;
  const mark = markOf(nonce);
  /** @type {Map<number, { sets: import("../engines/common.js").ResultSet[], affected: number, warnings: number }>} */
  const done = new Map();
  /** @type {import("../engines/common.js").ResultSet[]} */
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
