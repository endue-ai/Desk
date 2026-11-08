// What the grid draws, without the DOM: the rows in their order on screen (sorted by a column,
// kept by a quick filter, the rows added at the end), each cell's value with its pending change,
// and a record view of one row. Row numbers are the result's own, so a change lands on the row the
// server sent whatever the order on screen.

import { cellAt } from "./edit/pending.js";
import { numericColumns } from "./results.js";

/**
 * @typedef {import("./engines/common.js").ResultSet} ResultSet
 * @typedef {import("./edit/pending.js").Changes} Changes
 * @typedef {{ column: number, direction: "asc" | "desc" } | null} Sort
 * @typedef {{ value: string | null, changed: boolean, inserted: boolean, deleted: boolean }} Cell
 */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The result rows in screen order: sorted (numbers by value, NULL last, stable), those holding the
 * filter's text, then the rows added (never filtered out, so a new row stays in sight).
 * @param {ResultSet} set
 * @param {Changes | null} changes
 * @param {Sort} sort
 * @param {string} filter
 * @returns {number[]}
 */
export function rowOrder(set, changes, sort, filter) {
  let order = set.rows.map((_, i) => i);
  const needle = filter.trim().toLowerCase();
  if (needle) {
    order = order.filter((r) =>
      set.columns.some((_, c) => {
        const value = valueAt(set, changes, r, c).value;
        return (value === null ? "null" : value.toLowerCase()).includes(needle);
      }),
    );
  }
  if (sort) {
    const numeric = numericColumns(set)[sort.column] ?? false;
    const sign = sort.direction === "asc" ? 1 : -1;
    order.sort((a, b) => {
      const x = valueAt(set, changes, a, sort.column).value;
      const y = valueAt(set, changes, b, sort.column).value;
      if (x === null || y === null) return x === y ? a - b : x === null ? 1 : -1;
      const by = numeric ? Number(x) - Number(y) : collator.compare(x, y);
      return by === 0 ? a - b : sign * by;
    });
  }
  const added = changes ? changes.inserts.map((_, i) => set.rows.length + i) : [];
  return [...order, ...added];
}

/** A cell's value with its pending change. @returns {Cell} */
export function valueAt(
  /** @type {ResultSet} */ set,
  /** @type {Changes | null} */ changes,
  /** @type {number} */ row,
  /** @type {number} */ col,
) {
  if (changes) return cellAt(changes, set, row, col);
  return { value: set.rows[row]?.[col] ?? null, changed: false, inserted: false, deleted: false };
}

/** The rows in screen order as values (pending changes in), for copying and exporting. */
export function rowsShown(
  /** @type {ResultSet} */ set,
  /** @type {Changes | null} */ changes,
  /** @type {number[]} */ order,
) {
  return order.map((r) => set.columns.map((_, c) => valueAt(set, changes, r, c).value));
}

/** A cell's text in the grid: NULL apart, line breaks shown, long values cut. */
export function cellText(/** @type {string | null} */ value) {
  if (value === null) return "NULL";
  const short = value.length > 500 ? `${value.slice(0, 500)}…` : value;
  return short.replace(/\r?\n/gu, "↵ ");
}

/** Each column's width in characters, from its name and the first rows. */
export function widths(/** @type {ResultSet} */ set, max = 48) {
  return set.columns.map((name, c) => {
    let width = name.length + 2;
    for (const row of set.rows.slice(0, 200))
      width = Math.max(width, Math.min(max, cellText(row[c] ?? "NULL").length + 1));
    return Math.min(max, Math.max(6, width));
  });
}
