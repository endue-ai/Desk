// Quick filters and sort keys as the person sees them and as SQL: a filter's words on its chip and
// in the cell's menu, and, for a table view, each filter as a condition after the WHERE the person
// typed and the keys as the ORDER BY (ADR 0288). Names are always quoted and values are literals,
// so nothing the cell holds can end the condition. No DOM.

import { quoteName, quoteText } from "../sql/quote.js";
import { t } from "../strings/index.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("./rows.js").FilterOp} FilterOp
 * @typedef {{ key: string, name: string, op: FilterOp, value: string | null, numeric: boolean }} Filter
 *   `key` is the column's key (columns.js), `name` its name as SQL knows it.
 * @typedef {{ key: string, name: string, direction: "asc" | "desc" }} SortKey
 */

/** The operations a cell's menu offers, in its order. @type {FilterOp[]} */
export const OPS = ["eq", "ne", "gt", "lt", "contains", "empty", "null", "notNull"];
/** The operations that compare with the cell's value. */
export const WITH_VALUE = new Set(["eq", "ne", "gt", "lt"]);
const SQL = { eq: "=", ne: "<>", gt: ">", lt: "<" };
const SHOWN = { eq: "=", ne: "≠", gt: ">", lt: "<" };
const NUMBER = /^-?\d+(\.\d+)?$/u;

/** A value as the chip and the menu show it: a number bare in a numeric column, text quoted and cut. */
function shown(/** @type {string | null} */ value, /** @type {boolean} */ numeric) {
  if (value === null) return "NULL";
  if (numeric && NUMBER.test(value)) return value;
  const cut = value.length > 24 ? `${value.slice(0, 24)}…` : value;
  return `'${cut.replace(/\r?\n/gu, "↵ ")}'`;
}

/** A filter's words on its chip: `name = 'Cy'`, `total > 12`, `note is NULL`. */
export function filterLabel(/** @type {Filter} */ filter) {
  const { name, op, value, numeric } = filter;
  if (op === "contains")
    return t("grid.filters.contains", { name: String(name), value: String(shown(value, false)) });
  if (op === "empty") return t("grid.filters.isEmpty", { name: String(name) });
  if (op === "null") return t("grid.filters.isNull", { name: String(name) });
  if (op === "notNull") return t("grid.filters.isNotNull", { name: String(name) });
  return `${name} ${SHOWN[op]} ${shown(value, numeric)}`;
}

/** A menu item's words for a cell's value: `= 'Ada'`, `Contains…`, `Is NULL`. */
export function menuLabel(
  /** @type {FilterOp} */ op,
  /** @type {string | null} */ value,
  /** @type {boolean} */ numeric,
) {
  if (op === "contains") return t("grid.filters.contains2");
  if (op === "empty") return t("grid.filters.isEmpty2");
  if (op === "null") return t("grid.filters.isNull2");
  if (op === "notNull") return t("grid.filters.isNotNull2");
  return `${SHOWN[op]} ${shown(value, numeric)}`;
}

/** LIKE's pattern for a text anywhere in the value, `!` escaping the wildcards. */
const containing = (/** @type {string} */ text) =>
  `%${text.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`;

/** One filter as a condition in a dialect. */
export function filterSql(/** @type {Dialect} */ dialect, /** @type {Filter} */ filter) {
  const column = quoteName(dialect, filter.name);
  const value = filter.value ?? "";
  if (filter.op === "null") return `${column} IS NULL`;
  if (filter.op === "notNull") return `${column} IS NOT NULL`;
  if (filter.op === "empty") return `${column} = ''`;
  if (filter.op === "contains") {
    const pattern = `${quoteText(dialect, containing(value))} ESCAPE '!'`;
    if (dialect === "postgresql") return `CAST(${column} AS text) ILIKE ${pattern}`;
    if (dialect === "mysql") return `CAST(${column} AS CHAR) LIKE ${pattern}`;
    return `${column} LIKE ${pattern}`;
  }
  const literal = filter.numeric && NUMBER.test(value) ? value : quoteText(dialect, value);
  return `${column} ${SQL[filter.op]} ${literal}`;
}

/** The WHERE a table view runs: the typed filter, in parentheses, and then each quick filter. */
export function whereWith(
  /** @type {Dialect} */ dialect,
  /** @type {string} */ typed,
  /** @type {Filter[]} */ filters,
) {
  const own = typed.trim();
  const parts = filters.map((filter) => filterSql(dialect, filter));
  if (parts.length === 0) return own;
  return own ? `(${own}) AND ${parts.join(" AND ")}` : parts.join(" AND ");
}

/** The ORDER BY of a table view's sort keys. */
export function orderSql(/** @type {Dialect} */ dialect, /** @type {SortKey[]} */ keys) {
  return keys.map((k) => `${quoteName(dialect, k.name)} ${k.direction.toUpperCase()}`).join(", ");
}
