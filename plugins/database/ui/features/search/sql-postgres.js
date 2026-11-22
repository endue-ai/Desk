// PostgreSQL's condition for a column and a value: on text-like columns the operators an index can
// serve (=, LIKE, ILIKE, ~, ~*, lower() for equals ignoring case), a number compared as a number
// for equals, a uuid as a uuid, and the rest on the column's text. JSON on PostgreSQL 12 and later
// is matched on its values, never its keys: equal to a string or a number by a jsonpath
// (`$.** ? (@ == ...)`), and every other match on the text of each string and number of the
// document (jsonb_path_query). An older server reads the document's text. Every name and literal
// goes through ui/sql/quote.js. Pure.

import { quoteName, quoteText } from "../../sql/quote.js";
import { isNumber, jsonNumber } from "./columns.js";

/**
 * @typedef {import("./columns.js").Searched} Searched
 * @typedef {import("./columns.js").Match} Match
 * @typedef {{ value: string, match: Match, ignoreCase: boolean }} How
 */

/** The first server with jsonpath (server_version_num). */
export const JSONPATH = 120000;

const lit = (/** @type {string} */ value) => quoteText("postgresql", value);
/** LIKE's wildcards and its escape (a backslash) as plain characters. */
export const likeEscaped = (/** @type {string} */ value) => value.replace(/[\\%_]/gu, "\\$&");
/** A jsonpath string literal. */
export function pathString(/** @type {string} */ value) {
  const inner = value
    .replace(/[\\"]/gu, "\\$&")
    .replace(/\n/gu, "\\n")
    .replace(/\r/gu, "\\r")
    .replace(/\t/gu, "\\t");
  return `"${inner}"`;
}

/**
 * Text conditions on an expression of text.
 * @param {string} text
 * @param {How} how
 */
function onText(text, how) {
  const { value, match, ignoreCase } = how;
  const like = ignoreCase ? "ILIKE" : "LIKE";
  if (match === "equals")
    return ignoreCase ? `lower(${text}) = lower(${lit(value)})` : `${text} = ${lit(value)}`;
  if (match === "contains") return `${text} ${like} ${lit(`%${likeEscaped(value)}%`)}`;
  if (match === "starts") return `${text} ${like} ${lit(`${likeEscaped(value)}%`)}`;
  return `${text} ${ignoreCase ? "~*" : "~"} ${lit(value)}`;
}

/** The jsonpath that finds a document holding the value as a string or a number, as it is. */
export function jsonPath(/** @type {How} */ how) {
  const number = isNumber(how.value) ? ` || @ == ${jsonNumber(how.value)}` : "";
  return `$.** ? (@ == ${pathString(how.value)}${number})`;
}

/**
 * Any string or number of a document, at any depth, whose text passes a text condition.
 * @param {string} doc
 * @param {How} how
 */
const jsonValues = (doc, how) =>
  `EXISTS (SELECT 1 FROM jsonb_path_query(${doc}, 'strict $.**') AS j(v) ` +
  `WHERE jsonb_typeof(j.v) IN ('string', 'number') AND ${onText("(j.v #>> '{}')", how)})`;

/**
 * The condition that a column holds the value.
 * @param {Searched} column
 * @param {How} how
 * @param {number} version server_version_num
 */
export function postgresCondition(column, how, version) {
  const c = quoteName("postgresql", column.name);
  if (column.family === "text") return onText(c, how);
  if (column.family === "number" && how.match === "equals") return `${c} = ${how.value}`;
  if (column.family === "uuid") {
    if (how.match === "equals") return `${c} = ${lit(how.value.toLowerCase())}::uuid`;
    return onText(`${c}::text`, { ...how, ignoreCase: true });
  }
  if (column.family === "json" && version >= JSONPATH)
    return how.match === "equals" && !how.ignoreCase
      ? `jsonb_path_exists(${c}::jsonb, ${lit(jsonPath(how))})`
      : jsonValues(`${c}::jsonb`, how);
  return onText(`${c}::text`, how);
}

/** What a hit shows of the column: its text, cut, after a mark that no match is without. */
export const postgresExcerpt = (/** @type {Searched} */ column, /** @type {number} */ length) =>
  `'=' || left(${quoteName("postgresql", column.name)}::text, ${length})`;
