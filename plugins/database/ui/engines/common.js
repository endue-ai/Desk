// What every engine shares: the shapes a run plans and returns, and the steps of turning a client's
// outcome into statement outcomes (rows kept up to the limit, the first statement without its
// marker as the one that failed or was stopped, those after it as not run).

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("../sql/split.js").Statement} Statement
 * @typedef {"postgresql" | "mysql" | "sqlite"} EngineId
 * @typedef {"none" | "development" | "staging" | "production"} Tag
 * @typedef {"default" | "disable" | "prefer" | "require" | "verify-ca" | "verify-full"} SslMode
 * @typedef {{
 *   id: string, name: string, engine: EngineId, host: string, port: number | null,
 *   database: string, user: string, ssl: SslMode, sslCa: string, file: string,
 *   tag: Tag, readOnly: boolean,
 * }} Connection
 * @typedef {{ columns: string[], rows: (string | null)[][], truncated: boolean }} ResultSet
 * @typedef {"sql" | "auth" | "connect" | "client" | "timeout" | "cancelled" | "missing" | "refused"} ErrorKind
 * @typedef {{ kind: ErrorKind, message: string, code?: string, detail?: string, position?: number }} DbError
 *   `position` is an offset in the statement's text.
 * @typedef {{
 *   index: number, ran: boolean, sets: ResultSet[], affected: number | null,
 *   warnings: number, notices: string[], error?: DbError,
 * }} StatementOutcome
 * @typedef {{ statements: StatementOutcome[], notices: string[], error?: DbError, ms: number }} RunResult
 *   `error` is the run's own failure (cannot connect, no client), when no statement holds it.
 * @typedef {{ feed(chunk: string): number }} Counter
 * @typedef {{
 *   command: string, args: string[], env: Record<string, string>, cwd?: string,
 *   nonce: string, statements: Statement[], maxRows: number,
 *   counter?: Counter, stopAfter: number,
 * }} Invocation
 *   `stopAfter` > 0 stops the client once the counter reaches it (a single read, enough rows).
 * @typedef {{
 *   code: number | null, signal: string | null, stdout: string, stderr: string,
 *   stopped: boolean, cancelled: boolean, timedOut: boolean, overflow: boolean, ms: number,
 * }} Outcome
 * @typedef {{
 *   statements: Statement[], maxRows: number, timeoutMs: number, password?: string,
 *   mode: "run" | "transaction" | "dry-run", flavor?: "mysql" | "mariadb", nonce: string,
 *   single: boolean,
 * }} PlanOptions
 *   `single`: one statement that returns rows, which may be stopped once it has enough.
 */

/** The run as a whole failed: every statement is not run, and `error` says why. */
export function failedRun(
  /** @type {Statement[]} */ statements,
  /** @type {DbError} */ error,
  ms = 0,
) {
  return { statements: statements.map((_, index) => notRun(index)), notices: [], error, ms };
}

/** @returns {StatementOutcome} */
export function notRun(/** @type {number} */ index) {
  return { index, ran: false, sets: [], affected: null, warnings: 0, notices: [] };
}

/**
 * A table as a result set: at most `maxRows` rows, `truncated` when more arrived or the client was
 * stopped while it still had rows.
 * @param {string[]} columns
 * @param {(string | null)[][]} rows
 * @param {number} maxRows
 * @param {boolean} [stopped]
 * @returns {ResultSet}
 */
export function resultSet(columns, rows, maxRows, stopped = false) {
  return {
    columns,
    rows: rows.length > maxRows ? rows.slice(0, maxRows) : rows,
    truncated: rows.length > maxRows || (stopped && rows.length >= maxRows),
  };
}

/** Why the client ended without finishing, when it was not a failure of the statement. */
export function endedBy(/** @type {Outcome} */ outcome, /** @type {number} */ timeoutMs) {
  if (outcome.cancelled)
    return /** @type {DbError} */ ({ kind: "cancelled", message: "Cancelled." });
  if (outcome.timedOut)
    return /** @type {DbError} */ ({
      kind: "timeout",
      message: `Stopped after ${Math.round(timeoutMs / 1000)} s (the statement timeout).`,
    });
  if (outcome.overflow)
    return /** @type {DbError} */ ({
      kind: "client",
      message: "The client wrote more than 64 MiB; add a LIMIT or export from the terminal.",
    });
  return undefined;
}

/** Lines that are not empty, trimmed at the end. */
export const linesOf = (/** @type {string} */ text) =>
  text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");

/** Whether a client's words say a password is missing or wrong. */
export function authFailed(/** @type {string} */ text) {
  return /password authentication failed|no password supplied|fe_sendauth|28P01|Access denied for user|ERROR 1045|ERROR 1698/iu.test(
    text,
  );
}

/** The environment's PATH-free part, without empty values. */
export function env(/** @type {Record<string, string | undefined | null | false>} */ values) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(values)) if (value) out[key] = value;
  return out;
}

/** The position of `line`/`column` (1-based) of a statement's text, as an offset. */
export function offsetIn(
  /** @type {string} */ text,
  /** @type {number} */ line,
  /** @type {number} */ column,
) {
  let offset = 0;
  for (let l = 1; l < line; l++) {
    const nl = text.indexOf("\n", offset);
    if (nl < 0) return undefined;
    offset = nl + 1;
  }
  return Math.min(text.length, offset + Math.max(0, column - 1));
}
