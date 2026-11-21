// MySQL's and SQLite's condition for a column and a value, with each one's own functions. MySQL /
// MariaDB: a case is kept by comparing bytes (CAST ... AS BINARY) and folded with LOWER, a regular
// expression is REGEXP with an inline (?i) or (?-i) both flavours read, JSON's string values are
// found by JSON_SEARCH (its regular expression reads the document's text). SQLite: instr and substr
// on the text, the sqlite3 shell's REGEXP and regexpi, and JSON's values through json_tree. Every
// name and literal goes through ui/sql/quote.js. Pure.

import { quoteName, quoteText } from "../../sql/quote.js";
import { likeEscaped } from "./sql-postgres.js";

/**
 * @typedef {import("./columns.js").Searched} Searched
 * @typedef {import("./sql-postgres.js").How} How
 */

const my = (/** @type {string} */ value) => quoteText("mysql", value);
const lite = (/** @type {string} */ value) => quoteText("sqlite", value);
const length = (/** @type {string} */ value) => [...value].length;

/** Text conditions on a MySQL expression of text. */
function mysqlText(/** @type {string} */ text, /** @type {How} */ how) {
  const { value, match, ignoreCase } = how;
  const v = my(value);
  const bin = (/** @type {string} */ x) => `CAST(${x} AS BINARY)`;
  if (match === "regex") return `${text} REGEXP ${my(`${ignoreCase ? "(?i)" : "(?-i)"}${value}`)}`;
  if (match === "equals")
    return ignoreCase ? `LOWER(${text}) = LOWER(${v})` : `${bin(text)} = ${bin(v)}`;
  if (match === "contains")
    return ignoreCase
      ? `LOCATE(LOWER(${v}), LOWER(${text})) > 0`
      : `LOCATE(${bin(v)}, ${bin(text)}) > 0`;
  const head = `LEFT(${text}, ${length(value)})`;
  return ignoreCase ? `LOWER(${head}) = LOWER(${v})` : `${bin(head)} = ${bin(v)}`;
}

/**
 * MySQL's condition that a column holds the value.
 * @param {Searched} column
 * @param {How} how
 */
export function mysqlCondition(column, how) {
  const c = quoteName("mysql", column.name);
  if (column.family === "text") return mysqlText(c, how);
  if (column.family === "number" && how.match === "equals") return `${c} = ${how.value}`;
  if (column.family === "json" && how.match !== "regex") {
    const v = how.ignoreCase ? how.value.toLowerCase() : how.value;
    const pattern =
      how.match === "equals"
        ? likeEscaped(v)
        : how.match === "starts"
          ? `${likeEscaped(v)}%`
          : `%${likeEscaped(v)}%`;
    const doc = how.ignoreCase ? `LOWER(${c})` : c;
    return `JSON_SEARCH(${doc}, 'one', ${my(pattern)}) IS NOT NULL`;
  }
  return mysqlText(`CAST(${c} AS CHAR)`, how);
}

/** Text conditions on a SQLite expression of text. */
function sqliteText(/** @type {string} */ text, /** @type {How} */ how, plain = text) {
  const { value, match, ignoreCase } = how;
  const v = lite(value);
  const fold = (/** @type {string} */ x) => (ignoreCase ? `lower(${x})` : x);
  if (match === "regex") return ignoreCase ? `regexpi(${v}, ${text})` : `${text} REGEXP ${v}`;
  if (match === "equals") return ignoreCase ? `lower(${text}) = lower(${v})` : `${plain} = ${v}`;
  if (match === "contains") return `instr(${fold(text)}, ${fold(v)}) > 0`;
  return `substr(${fold(text)}, 1, ${length(value)}) = ${fold(v)}`;
}

/**
 * SQLite's condition that a column holds the value.
 * @param {Searched} column
 * @param {How} how
 */
export function sqliteCondition(column, how) {
  const c = quoteName("sqlite", column.name);
  const text = `CAST(${c} AS TEXT)`;
  if (column.family === "text") return sqliteText(text, how, c);
  if (column.family === "number" && how.match === "equals") return `${c} = ${how.value}`;
  if (column.family === "json") {
    const atom = sqliteText("CAST(j.atom AS TEXT)", how);
    return (
      `CASE WHEN json_valid(${c}) THEN EXISTS (SELECT 1 FROM json_tree(${c}) j ` +
      `WHERE j.type IN ('text', 'integer', 'real') AND ${atom}) ELSE 0 END`
    );
  }
  if (column.family === "uuid") return sqliteText(text, { ...how, ignoreCase: true });
  return sqliteText(text, how);
}

/** What a hit shows of a column on MySQL or SQLite: its text, cut, after the same mark. */
export function otherExcerpt(
  /** @type {"mysql" | "sqlite"} */ engine,
  /** @type {Searched} */ column,
  /** @type {number} */ n,
) {
  const c = quoteName(engine, column.name);
  return engine === "mysql"
    ? `CONCAT('=', LEFT(CAST(${c} AS CHAR), ${n}))`
    : `'=' || substr(CAST(${c} AS TEXT), 1, ${n})`;
}
