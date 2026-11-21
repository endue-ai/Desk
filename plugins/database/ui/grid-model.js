// What the grid draws, without the DOM: the rows in their order on screen (sorted by several keys,
// kept by the quick filters and the text filter, the rows added at the end; grid/rows.js does the
// work on indexes), each cell's value with its pending change, and each column's default width.
// Row numbers are the result's own, so a change lands on the row the server sent whatever the
// order on screen.

import { cellAt } from "./edit/pending.js";
import { CELL_PAD, columnKeys, NAME_ROOM } from "./grid/columns.js";
import { orderRows } from "./grid/rows.js";
import { numericColumns } from "./results.js";

/**
 * @typedef {import("./engines/common.js").ResultSet} ResultSet
 * @typedef {import("./edit/pending.js").Changes} Changes
 * @typedef {{ column: number, direction: "asc" | "desc" } | null} Sort
 * @typedef {{ value: string | null, changed: boolean, inserted: boolean, deleted: boolean }} Cell
 * @typedef {import("./grid/filters.js").Filter} Filter
 * @typedef {import("./grid/filters.js").SortKey} SortKey
 * @typedef {{ sort: SortKey[], filters: Filter[], text: string, search: number[] }} Shape
 *   The keys and filters by column key; `search` the result columns the text filter looks in.
 */

/** The result rows added as pending changes, after the others. */
const withAdded = (
  /** @type {ResultSet} */ set,
  /** @type {Changes | null} */ changes,
  /** @type {number[]} */ order,
) => (changes ? [...order, ...changes.inserts.map((_, i) => set.rows.length + i)] : order);

/** Read a result's cells with their pending changes. */
const reader =
  (/** @type {ResultSet} */ set, /** @type {Changes | null} */ changes) =>
  (/** @type {number} */ row, /** @type {number} */ col) =>
    valueAt(set, changes, row, col).value;

/**
 * The rows in screen order under sort keys and quick filters named by column key; a key or filter
 * of a column the result does not have is left out. Added rows are never filtered out.
 * @param {ResultSet} set
 * @param {Changes | null} changes
 * @param {Shape} shape
 */
export function orderOf(set, changes, { sort, filters, text, search }) {
  const at = new Map(columnKeys(set.columns).map((key, i) => [key, i]));
  const numeric = numericColumns(set);
  const order = orderRows({
    count: set.rows.length,
    value: reader(set, changes),
    numeric,
    sort: sort.flatMap((k) =>
      at.has(k.key) ? [{ column: at.get(k.key) ?? 0, direction: k.direction }] : [],
    ),
    filters: filters.flatMap((f) =>
      at.has(f.key) ? [{ column: at.get(f.key) ?? 0, op: f.op, value: f.value }] : [],
    ),
    text,
    search,
  });
  return withAdded(set, changes, order);
}

/**
 * The result rows in screen order: sorted by one column (numbers by value, NULL last, stable), those
 * holding the filter's text in any column, then the rows added.
 * @param {ResultSet} set
 * @param {Changes | null} changes
 * @param {Sort} sort
 * @param {string} filter
 * @returns {number[]}
 */
export function rowOrder(set, changes, sort, filter) {
  const order = orderRows({
    count: set.rows.length,
    value: reader(set, changes),
    numeric: numericColumns(set),
    sort: sort ? [sort] : [],
    filters: [],
    text: filter,
    search: set.columns.map((_, c) => c),
  });
  return withAdded(set, changes, order);
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
  /** @type {ArrayLike<number>} */ order,
) {
  return Array.from(order, (r) => set.columns.map((_, c) => valueAt(set, changes, r, c).value));
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
    let width = name.length + NAME_ROOM;
    for (const row of set.rows.slice(0, 200))
      width = Math.max(width, Math.min(max, cellText(row[c] ?? "NULL").length + 1));
    return Math.min(max, Math.max(6, width));
  });
}

/** Each column's default width in pixels, for a character `ch` pixels wide. */
export function defaultWidths(/** @type {ResultSet} */ set, /** @type {number} */ ch) {
  return widths(set).map((chars) => Math.ceil(chars * ch) + CELL_PAD);
}
