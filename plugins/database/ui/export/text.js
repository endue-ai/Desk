// An export's text (PG-61): each text format as lines, joined by the line ending chosen and ended by
// one, so a line break inside a value (a CSV field, a string literal) is never changed. CSV and TSV
// take a delimiter, quoting, a header and the text for NULL; INSERT goes in batches; HTML is a table
// whose NULL cells say so (`data-null`); XML is `<rows><row><value column="…">` with NULL as
// `null="true"` and a value XML cannot hold (a control character) as base64; a template writes each
// row through its placeholders. JSON, Markdown and UPDATE are the copy formats (results.js). No DOM.

import { literal } from "../edit/values.js";
import { formatRows } from "../results.js";
import { quoteName } from "../sql/quote.js";
import { xmlSafe } from "./chars.js";

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../results.js").FormatOptions} FormatOptions
 * @typedef {import("./options.js").ExportFormat} ExportFormat
 * @typedef {import("./options.js").ExportOptions} ExportOptions
 */

/**
 * The text of a result as a text format.
 * @param {ResultSet} set
 * @param {Exclude<ExportFormat, "xlsx">} format
 * @param {ExportOptions} options
 * @param {FormatOptions} [base] The result's dialect, table, types and key, and the selection.
 */
export function exportText(set, format, options, base = {}) {
  const eol = options.lineEnding === "crlf" ? "\r\n" : "\n";
  const lines = linesOf(set, format, options, base);
  return lines.length ? `${lines.join(eol)}${eol}` : "";
}

/** The columns and rows a selection picks. */
export function picked(/** @type {ResultSet} */ set, /** @type {FormatOptions} */ base) {
  const pick = base.columns ?? set.columns.map((_, i) => i);
  return {
    pick,
    columns: pick.map((i) => set.columns[i] ?? ""),
    rows: (base.rows ?? set.rows).map((row) => pick.map((i) => row[i] ?? null)),
  };
}

/**
 * @param {ResultSet} set
 * @param {Exclude<ExportFormat, "xlsx">} format
 * @param {ExportOptions} o
 * @param {FormatOptions} base
 * @returns {string[]}
 */
function linesOf(set, format, o, base) {
  const { pick, columns, rows } = picked(set, base);
  if (format === "csv" || format === "tsv") {
    const field = format === "csv" ? csvField(o) : tsvField(o);
    const header = o.header ? [columns.map((c) => field(c, true)).join(o.delimiter)] : [];
    return [...header, ...rows.map((row) => row.map((v) => field(v, false)).join(o.delimiter))];
  }
  if (format === "insert") return inserts(columns, rows, pick, o, base);
  if (format === "html") return html(columns, rows, o);
  if (format === "xml") return xml(columns, rows, o);
  if (format === "template") return template(columns, rows, o);
  if (format === "markdown") {
    const nulls = rows.map((row) => row.map((v) => (v === null ? o.null : v)));
    const markdown = formatRows({ columns, rows: nulls, truncated: false }, "markdown");
    return markdown.split("\n");
  }
  const table = o.table || base.table;
  if (format === "update")
    return (base.rows ?? set.rows).map((row) =>
      formatRows(set, "update", { ...base, ...(table ? { table } : {}), rows: [row] }),
    );
  // JSON escapes every line break inside a value, so its own are the only ones.
  return formatRows(set, "json", base).split("\n");
}

/** A CSV field: quoted as asked; a value that reads as NULL or breaks the line is quoted when needed. */
const csvField = (/** @type {ExportOptions} */ o) => {
  const special = new RegExp(`["\\r\\n${o.delimiter.replace(/[\\^\]-]/gu, "\\$&")}]`, "u");
  return (/** @type {string | null} */ value, /** @type {boolean} */ name) => {
    if (value === null) return o.null;
    const quote =
      o.quote === "always" ||
      (o.quote === "needed" && (special.test(value) || (!name && value === o.null)));
    return quote ? `"${value.replaceAll('"', '""')}"` : value;
  };
};

/** A TSV field as COPY's text format writes it: backslash escapes, the delimiter's too. */
const tsvField = (/** @type {ExportOptions} */ o) => {
  const escaped = o.delimiter === "\t" ? "" : o.delimiter;
  return (/** @type {string | null} */ value) => {
    if (value === null) return o.null;
    let out = value
      .replaceAll("\\", "\\\\")
      .replaceAll("\t", "\\t")
      .replaceAll("\n", "\\n")
      .replaceAll("\r", "\\r");
    if (escaped) out = out.replaceAll(escaped, `\\${escaped}`);
    return out;
  };
};

/** INSERT statements of `batch` rows each, every value its column's literal. */
function inserts(
  /** @type {string[]} */ columns,
  /** @type {(string | null)[][]} */ rows,
  /** @type {number[]} */ pick,
  /** @type {ExportOptions} */ o,
  /** @type {FormatOptions} */ base,
) {
  const dialect = base.dialect ?? "postgresql";
  const table = o.table || base.table || "t";
  const names = columns.map((c) => quoteName(dialect, c)).join(", ");
  const tuple = (/** @type {(string | null)[]} */ row) =>
    `(${row.map((v, c) => literal(dialect, v, base.types?.[pick[c] ?? 0] ?? "")).join(", ")})`;
  if (o.batch === 1)
    return rows.map((row) => `INSERT INTO ${table} (${names}) VALUES ${tuple(row)};`);
  // A batch's own line breaks follow the line ending chosen; a value's stay inside its literal.
  /** @type {string[]} */
  const out = [];
  for (let at = 0; at < rows.length; at += o.batch) {
    const batch = rows.slice(at, at + o.batch);
    out.push(`INSERT INTO ${table} (${names}) VALUES`);
    for (const [i, row] of batch.entries())
      out.push(`  ${tuple(row)}${i < batch.length - 1 ? "," : ";"}`);
  }
  return out;
}

const escapeXml = (/** @type {string} */ s) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\r", "&#13;");

/** An HTML document of one table; a NULL cell is marked so it reads back as NULL. */
function html(
  /** @type {string[]} */ columns,
  /** @type {(string | null)[][]} */ rows,
  /** @type {ExportOptions} */ o,
) {
  const cell = (/** @type {string | null} */ v) =>
    v === null ? `<td data-null>${escapeXml(o.null)}</td>` : `<td>${escapeXml(v)}</td>`;
  const charset = o.encoding === "utf-8" ? "utf-8" : "utf-16";
  return [
    "<!DOCTYPE html>",
    `<html><head><meta charset="${charset}"><title>Export</title></head><body>`,
    "<table>",
    ...(o.header
      ? [`<thead><tr>${columns.map((c) => `<th>${escapeXml(c)}</th>`).join("")}</tr></thead>`]
      : []),
    "<tbody>",
    ...rows.map((row) => `<tr>${row.map(cell).join("")}</tr>`),
    "</tbody>",
    "</table>",
    "</body></html>",
  ];
}

/** UTF-8 bytes as base64, a piece at a time. */
export function base64Of(/** @type {Uint8Array} */ bytes) {
  let out = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    out += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(out);
}

/** An XML document: a row element per row, a value element per column. */
function xml(
  /** @type {string[]} */ columns,
  /** @type {(string | null)[][]} */ rows,
  /** @type {ExportOptions} */ o,
) {
  const name = columns.map((c) => escapeXml(c).replaceAll("\n", "&#10;").replaceAll("\t", "&#9;"));
  const value = (/** @type {string | null} */ v, /** @type {number} */ c) => {
    const column = `column="${name[c]}"`;
    if (v === null) return `    <value ${column} null="true"/>`;
    if (!xmlSafe(v))
      return `    <value ${column} encoding="base64">${base64Of(new TextEncoder().encode(v))}</value>`;
    return `    <value ${column}>${escapeXml(v)}</value>`;
  };
  const encoding = o.encoding === "utf-8" ? "UTF-8" : "UTF-16";
  return [
    `<?xml version="1.0" encoding="${encoding}"?>`,
    "<rows>",
    ...rows.flatMap((row) => ["  <row>", ...row.map(value), "  </row>"]),
    "</rows>",
  ];
}

const PLACEHOLDER = /\{\{([^{}]+)\}\}/gu;

/** The person's template: the head, each row through its placeholders, the separator, the foot;
 * `{{#}}` counts from `start` + 1 (a whole export writes its rows in pieces, export/stream.js). */
export function template(
  /** @type {string[]} */ columns,
  /** @type {(string | null)[][]} */ rows,
  /** @type {ExportOptions} */ o,
  start = 0,
) {
  const at = (/** @type {string} */ key) => {
    const name = key.trim();
    if (name === "#") return -1;
    const named = columns.indexOf(name);
    if (named >= 0) return named;
    const n = /^[1-9][0-9]*$/u.test(name) ? Number(name) - 1 : -2;
    if (n >= 0 && n < columns.length) return n;
    throw new Error(`Export: the template's {{${name}}} names no column of the result.`);
  };
  const parts = o.row.split(PLACEHOLDER);
  const slots = parts.map((part, i) => (i % 2 ? at(part) : -3));
  const line = (/** @type {(string | null)[]} */ row, /** @type {number} */ r) =>
    parts
      .map((part, i) => {
        const slot = slots[i] ?? -3;
        if (slot === -3) return part;
        if (slot === -1) return String(start + r + 1);
        return row[slot] ?? o.null;
      })
      .join("");
  const body = rows.map((row, r) => line(row, r) + (r < rows.length - 1 ? o.separator : ""));
  return [...(o.head ? [o.head] : []), ...body, ...(o.foot ? [o.foot] : [])];
}
