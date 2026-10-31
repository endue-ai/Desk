// A result set as other formats (tab-separated for the clipboard, CSV, JSON, Markdown, INSERT
// statements), sorted by a column, and which columns hold numbers. NULL stays NULL in every format:
// an empty CSV field is '' quoted, JSON null, \N in TSV. No DOM.

import { quoteName, quoteText } from "./sql/quote.js";

/**
 * @typedef {import("./engines/common.js").ResultSet} ResultSet
 * @typedef {import("./sql/lexer.js").Dialect} Dialect
 * @typedef {"tsv" | "csv" | "json" | "markdown" | "insert"} Format
 */

export const FORMATS = /** @type {const} */ (["tsv", "csv", "json", "markdown", "insert"]);
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/u;

/** Whether every value of each column that is not NULL is a number. */
export function numericColumns(/** @type {ResultSet} */ set) {
  return set.columns.map((_, c) => {
    let seen = false;
    for (const row of set.rows) {
      const value = row[c];
      if (value === null || value === undefined) continue;
      if (!NUMBER.test(value)) return false;
      seen = true;
    }
    return seen;
  });
}

/**
 * The rows ordered by one column, numbers by value, NULL last either way. Stable.
 * @param {ResultSet} set
 * @param {number} column
 * @param {"asc" | "desc"} direction
 */
export function sortRows(set, column, direction) {
  const numeric = numericColumns(set)[column] ?? false;
  const sign = direction === "asc" ? 1 : -1;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return set.rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = a.row[column] ?? null;
      const y = b.row[column] ?? null;
      if (x === null || y === null) return x === y ? a.index - b.index : x === null ? 1 : -1;
      const order = numeric ? Number(x) - Number(y) : collator.compare(x, y);
      return order === 0 ? a.index - b.index : sign * order;
    })
    .map(({ row }) => row);
}

/**
 * @param {ResultSet} set
 * @param {Format} format
 * @param {{ dialect?: Dialect, table?: string, rows?: (string | null)[][], columns?: number[] }} [options]
 *   `rows` and `columns` pick part of the set (a selection); `table` names INSERT's target.
 */
export function formatRows(set, format, options = {}) {
  const pick = options.columns ?? set.columns.map((_, i) => i);
  const columns = pick.map((i) => set.columns[i] ?? "");
  const rows = (options.rows ?? set.rows).map((row) => pick.map((i) => row[i] ?? null));
  if (format === "csv")
    return [columns, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
  if (format === "json") {
    const numeric = numericColumns({ columns: set.columns, rows: set.rows, truncated: false });
    const objects = rows.map((row) =>
      Object.fromEntries(
        row.map((value, c) => [columns[c], jsonValue(value, numeric[pick[c] ?? 0] ?? false)]),
      ),
    );
    return JSON.stringify(objects, null, 2);
  }
  if (format === "markdown") {
    const cell = (/** @type {string | null} */ v) =>
      (v === null ? "NULL" : v).replaceAll("|", "\\|").replaceAll("\n", "<br>");
    const head = `| ${columns.map(cell).join(" | ")} |`;
    const rule = `| ${columns.map(() => "---").join(" | ")} |`;
    return [head, rule, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");
  }
  if (format === "insert")
    return inserts(options.dialect ?? "postgresql", options.table ?? "t", columns, rows);
  return rows.map((row) => row.map(tsvField).join("\t")).join("\n");
}

/** A CSV field: quoted when it must be, and '' quoted so it is not NULL (an empty field). */
function csvField(/** @type {string | null} */ value) {
  if (value === null) return "";
  if (value === "" || /[",\r\n]/u.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/** A TSV field as databases read it back: \N for NULL, tabs and line breaks escaped. */
function tsvField(/** @type {string | null} */ value) {
  if (value === null) return "\\N";
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\t", "\\t")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
}

/** A number stays a JSON number only when it reads back exactly. */
function jsonValue(/** @type {string | null} */ value, /** @type {boolean} */ numeric) {
  if (value === null || !numeric) return value;
  const n = Number(value);
  return String(n) === value ? n : value;
}

/** One INSERT per row, values as literals. */
function inserts(
  /** @type {Dialect} */ dialect,
  /** @type {string} */ table,
  /** @type {string[]} */ columns,
  /** @type {(string | null)[][]} */ rows,
) {
  const names = columns.map((c) => quoteName(dialect, c)).join(", ");
  return rows
    .map(
      (row) =>
        `INSERT INTO ${table} (${names}) VALUES (${row.map((v) => sqlValue(dialect, v)).join(", ")});`,
    )
    .join("\n");
}

/** A value as a literal: NULL, a number as it is, text quoted. */
function sqlValue(/** @type {Dialect} */ dialect, /** @type {string | null} */ value) {
  if (value === null) return "NULL";
  return NUMBER.test(value) ? value : quoteText(dialect, value);
}
