// What psql printed, read in the result worker (ui/output-worker.js, #38): the text between the
// marker lines `\echo` and `\warn` print after each statement (ui/engines/postgres.js), its CSV
// with the random NULL text, and the error psql wrote. Imports only relative files.

import {
  authFailed,
  endedBy,
  failedRun,
  linesOf,
  notRun,
  offsetIn,
  resultSet,
} from "../engines/common.js";
import { escapeRegExp, markOf, nullOf } from "../engines/text.js";
import { readCsv, segments } from "./csv.js";

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
export function readPostgres(outcome, invocation, timeoutMs) {
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
