// A value of a cell as an SQL literal of its dialect, for the statements the plugin writes from the
// grid (pending changes, copy and export as INSERT or UPDATE). NULL is NULL; a number in a numeric
// column stays a number; bytes in a binary column become the dialect's hex literal; everything else
// is a quoted string (quote.js), never raw text. A quoted literal is what the server would read for
// the column anyway: PostgreSQL types an unknown literal by its column, MySQL converts it, and
// SQLite's column affinity turns '42' into 42 where the column wants a number.

import { quoteText } from "../sql/quote.js";

/** @typedef {import("../sql/lexer.js").Dialect} Dialect */

export const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/u;
const HEX = /^(?:0x|\\x)((?:[0-9a-fA-F]{2})*)$/u;
const NUMERIC_TYPE =
  /\b(?:int|integer|smallint|bigint|tinyint|mediumint|int[248]|serial|bigserial|smallserial|numeric|decimal|dec|real|float[48]?|double|money|number|bit)\b/iu;
const BINARY_TYPE = /\b(?:bytea|blob|tinyblob|mediumblob|longblob|binary|varbinary)\b/iu;

/**
 * SQLite's affinity of a declared type (datatype3.html, 3.1): INTEGER, TEXT, BLOB, REAL or NUMERIC.
 * @param {string} declared
 */
export function affinity(declared) {
  const type = declared.toUpperCase();
  if (type.includes("INT")) return "integer";
  if (/CHAR|CLOB|TEXT/u.test(type)) return "text";
  if (type === "" || type.includes("BLOB")) return "blob";
  if (/REAL|FLOA|DOUB/u.test(type)) return "real";
  return "numeric";
}

/** Whether a column of this type holds numbers. */
export function numericType(/** @type {Dialect} */ dialect, /** @type {string} */ type) {
  if (dialect === "sqlite") return affinity(type) !== "text" && affinity(type) !== "blob";
  return NUMERIC_TYPE.test(type) && !/\bbit\s+varying\b/iu.test(type);
}

/** Whether a column of this type holds bytes. */
export function binaryType(/** @type {Dialect} */ dialect, /** @type {string} */ type) {
  if (dialect === "sqlite") return /BLOB/iu.test(type);
  return BINARY_TYPE.test(type);
}

/**
 * The literal for `value` in a column of `type` ("" when the type is not known).
 * @param {Dialect} dialect
 * @param {string | null} value
 * @param {string} [type]
 */
export function literal(dialect, value, type = "") {
  if (value === null) return "NULL";
  const hex = HEX.exec(value);
  if (hex && binaryType(dialect, type)) {
    const digits = (hex[1] ?? "").toUpperCase();
    if (dialect === "postgresql") return quoteText(dialect, `\\x${digits.toLowerCase()}`);
    if (dialect === "mysql") return digits ? `0x${digits}` : "''";
    return `X'${digits}'`;
  }
  if (NUMBER.test(value)) {
    // Without a type, what looks like a number is one. SQLite's columns without an affinity keep
    // what they are given, so a number stays a number there too.
    if (type === "" || numericType(dialect, type)) return value;
    if (dialect === "sqlite" && affinity(type) === "blob") return value;
  }
  return quoteText(dialect, value);
}
