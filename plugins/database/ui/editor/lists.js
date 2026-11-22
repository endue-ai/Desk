// The parts completion writes from what the schema knows: INSERT's column list with a VALUES row
// whose every value is a tab stop (all columns, and those without a default), a VALUES row for the
// columns listed, and `*` written out as the columns of what it reads, qualified when it reads more
// than one FROM item. Pure.

import { keyOf } from "./rank.js";
import { literal } from "./snippets.js";

/**
 * @typedef {import("./rank.js").Item} Item
 * @typedef {import("./joins.js").Column} Column
 * @typedef {import("./joins.js").Entry} Entry
 */

/** A tab stop named after a column. */
const stop = (/** @type {string} */ name) => `\${${literal(name)}}`;

/**
 * INSERT INTO t ( with nothing listed yet: every column, then those without a default, each with
 * its VALUES row when nothing follows the caret.
 * @param {Column[]} columns
 * @param {(name: string) => string} ident
 * @param {{ upper: boolean, rest: boolean }} how
 * @returns {Item[]}
 */
export function insertItems(columns, ident, { upper, rest }) {
  const values = upper ? "VALUES" : "values";
  const item = (/** @type {Column[]} */ list, /** @type {string} */ detail, scope = 0) => {
    const names = list.map((c) => literal(ident(c.name))).join(", ");
    const row = list.map((c) => stop(c.name)).join(", ");
    return /** @type {Item} */ ({
      label: list.map((c) => c.name).join(", "),
      kind: "columns",
      detail,
      insert: rest ? names : `${names}) ${values} (${row})`,
      snippet: true,
      scope,
      key: keyOf("columns", detail),
    });
  };
  if (columns.length === 0) return [];
  const items = [item(columns, rest ? "every column" : "every column, with a VALUES row")];
  const required = columns.filter((c) => !c.default);
  if (required.length > 0 && required.length < columns.length)
    items.push(item(required, "the columns without a default", 0.5));
  return items;
}

/**
 * VALUES ( at a row's start: a tab stop for each column the row takes.
 * @param {Column[]} columns the columns listed, else the table's
 * @param {boolean} rest whether something follows the caret
 * @returns {Item[]}
 */
export function rowItems(columns, rest) {
  if (columns.length === 0) return [];
  return [
    {
      label: columns.map((c) => c.name).join(", "),
      kind: "columns",
      detail: "a value for each column",
      insert: `${columns.map((c) => stop(c.name)).join(", ")}${rest ? "" : ")"}`,
      snippet: true,
      key: keyOf("columns", "row"),
    },
  ];
}

/**
 * `*` or `t.*` written out, over [from, to) of the statement.
 * @param {Entry[]} entries what the star reads
 * @param {{ from: number, to: number, qualifier: string[] }} star
 * @param {(name: string) => string} ident
 * @returns {Item[]}
 */
export function starItems(entries, star, ident) {
  const named = star.qualifier.length > 0;
  /** @type {string[]} */
  const parts = [];
  for (const entry of entries) {
    if (!entry.columns) return [];
    const by = named || entries.length > 1 ? `${ident(entry.name)}.` : "";
    for (const c of entry.columns) parts.push(`${by}${ident(c.name)}`);
  }
  if (parts.length === 0) return [];
  const text = parts.join(", ");
  return [
    {
      label: text.length > 60 ? `${text.slice(0, 59)}…` : text,
      kind: "expand",
      detail: `${parts.length} columns`,
      info: text,
      insert: text,
      range: { from: star.from, to: star.to },
      key: keyOf("expand", "*"),
    },
  ];
}
