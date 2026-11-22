// Masking what an agent reads (PG-91, ADR 0346). A sensitive column is `column`, `table.column` or
// `schema.table.column`. A result does not say which table a column came from, so a query's results
// mask every column of a sensitive column's name, whatever its table; sample rows and statistics,
// which read one table, mask only the entries that name it (or name no table). A statement that uses
// a sensitive column other than by selecting it under its own name (a filter, an expression, an
// alias, an ORDER BY) could carry its values out under another name: the agent's read is refused.
// Names compare without case, as unquoted names do. No DOM.

import { tokenize } from "../../sql/lexer.js";

/**
 * @typedef {import("../../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../../sql/lexer.js").Dialect} Dialect
 */

export const MASK = "(masked)";

const parts = (/** @type {string} */ entry) => entry.toLowerCase().split(".");

/** The sensitive columns' own names: every table's, for a query's results. */
export const namesOf = (/** @type {string[]} */ sensitive) =>
  new Set(sensitive.map((s) => /** @type {string} */ (parts(s).at(-1))));

/** The sensitive columns' names on one table. */
export function namesOn(
  /** @type {string[]} */ sensitive,
  /** @type {string} */ schema,
  /** @type {string} */ table,
) {
  const [s, t] = [schema.toLowerCase(), table.toLowerCase()];
  /** @type {Set<string>} */
  const names = new Set();
  for (const entry of sensitive) {
    const p = parts(entry);
    const column = /** @type {string} */ (p.at(-1));
    if (p.length === 1 || (p.length === 2 && p[0] === t) || (p[0] === s && p[1] === t))
      names.add(column);
  }
  return names;
}

/** A result set with every column of those names masked; the same set when none is. */
export function maskSet(/** @type {ResultSet} */ set, /** @type {Set<string>} */ names) {
  const at = set.columns.flatMap((c, i) => (names.has(c.toLowerCase()) ? [i] : []));
  if (at.length === 0) return set;
  const hidden = new Set(at);
  return { ...set, rows: set.rows.map((row) => row.map((v, i) => (hidden.has(i) ? MASK : v))) };
}

/**
 * The first sensitive name a statement uses more often than its results select it under that name,
 * or "" when every use is a column of its own name (then masked) or none is.
 * @param {string} text
 * @param {Dialect} dialect
 * @param {ResultSet[]} sets
 * @param {Set<string>} names
 */
export function leakOf(text, dialect, sets, names) {
  if (names.size === 0) return "";
  /** @type {Map<string, number>} */
  const used = new Map();
  for (const token of tokenize(text, dialect)) {
    const word =
      token.type === "word"
        ? token.text
        : token.type === "name"
          ? token.text.slice(1, -1).replaceAll(token.text[0] ?? "", "")
          : "";
    const name = word.toLowerCase();
    if (names.has(name)) used.set(name, (used.get(name) ?? 0) + 1);
  }
  for (const [name, count] of used) {
    const selected = sets.reduce(
      (n, set) => n + set.columns.filter((c) => c.toLowerCase() === name).length,
      0,
    );
    if (count > selected) return name;
  }
  return "";
}
