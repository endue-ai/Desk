// What a PostgreSQL session answers (db.*, ADR 0281) as a run's result: a statement's pages as one
// result set with its columns' type OIDs, the rows the command tag counts, the server's error with
// its SQLSTATE and its DETAIL, HINT, QUERY and CONTEXT lines as psql printed them, its position
// (characters from 1) as an offset into the statement, and notices as psql's lines. Pure.

/**
 * @typedef {import("@endue-ai/bridge").DbServerError} ServerError
 * @typedef {import("@endue-ai/bridge").DbColumn} Column
 * @typedef {import("./common.js").DbError} DbError
 * @typedef {import("./common.js").ResultSet} ResultSet
 */

/** SQLSTATEs of a sign-in refused for its password or role (class 28). */
const SIGN_IN = /^28/u;
/** query_canceled: by a cancel request, or by statement_timeout. */
export const CANCELED = "57014";

/** The labelled lines psql printed after an error's message, in its order. */
const LINES = /** @type {const} */ ([
  ["DETAIL", "detail"],
  ["HINT", "hint"],
  ["QUERY", "internalQuery"],
  ["CONTEXT", "where"],
]);

/**
 * A statement's rows as a result set: `maxRows` at most, `truncated` when the server had more.
 * @param {Column[]} columns
 * @param {(string | null)[][]} rows
 * @param {number} maxRows
 * @param {boolean} more
 * @returns {ResultSet}
 */
export function setOf(columns, rows, maxRows, more) {
  return {
    columns: columns.map((c) => c.name),
    rows: rows.length > maxRows ? rows.slice(0, maxRows) : rows,
    truncated: more || rows.length > maxRows,
    types: columns.map((c) => c.typeOid),
  };
}

/** The rows a command tag counts (`UPDATE 3`, `INSERT 0 1`), or null for one without (`CREATE TABLE`). */
export function affectedOf(/** @type {{ tag?: string, rowCount?: number }} */ page) {
  const count = /\s(\d+)$/u.exec(page.tag ?? "")?.[1];
  return count === undefined ? null : Number(count);
}

/**
 * The offset in `text` of a 1-based character position, as the server counts characters (code
 * points, where the string counts UTF-16 units).
 * @param {string} text
 * @param {number | undefined} position
 */
export function offsetOf(text, position) {
  if (!position || position < 1) return undefined;
  let offset = 0;
  let chars = 1;
  for (const char of text) {
    if (chars === position) return offset;
    offset += char.length;
    chars++;
  }
  return text.length;
}

/** The DETAIL, HINT, QUERY and CONTEXT lines of a server's error or notice. */
const linesOf = (/** @type {ServerError} */ error) =>
  LINES.flatMap(([label, field]) => (error[field] ? [`${label}:  ${error[field]}`] : []));

/**
 * The server's error of a statement as the plugin's: its SQLSTATE, message, the lines after it and
 * the position in `text`; `kind` says what ended it when it was not the statement itself.
 * @param {ServerError} error
 * @param {string} text the statement as it was sent
 * @param {DbError["kind"]} [kind]
 * @returns {DbError}
 */
export function errorOf(error, text, kind = "sql") {
  const detail = linesOf(error).join("\n");
  const position = offsetOf(text, error.position);
  return {
    kind: SIGN_IN.test(error.code) ? "auth" : kind,
    ...(error.code ? { code: error.code } : {}),
    message: error.message,
    ...(detail ? { detail } : {}),
    ...(position !== undefined ? { position } : {}),
  };
}

/** A sign-in the server refused: auth for a password or role it refused, connect otherwise. */
export function refusedOf(/** @type {ServerError} */ error) {
  const detail = linesOf(error).join(" ");
  const message = detail ? `${error.message}. ${detail}` : error.message;
  return /** @type {DbError} */ ({
    kind: SIGN_IN.test(error.code) ? "auth" : "connect",
    ...(error.code ? { code: error.code } : {}),
    message,
  });
}

/**
 * A notice as psql printed it: `NOTICE:  message`, a message of many lines (VACUUM VERBOSE's) a line
 * each, then its own DETAIL and HINT lines.
 */
export function noticeOf(/** @type {ServerError} */ notice) {
  return [...`${notice.severity}:  ${notice.message}`.split("\n"), ...linesOf(notice)];
}
