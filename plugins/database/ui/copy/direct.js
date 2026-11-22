// The COPY a whole export runs (PG-64): `COPY (<query>) TO STDOUT` in the server's CSV or text
// format when its output is exactly the file the options ask for, so its bytes go to the file as they
// come, else in the text format, which the plugin reads back (text.js) and writes through its own
// writers. CSV matches with LF, UTF-8, quoting when needed, an ASCII delimiter and a NULL text the
// server takes; the server also quotes a lone `\.` of a one-column result, which the plugin's writer
// does not, so a single column goes through the writer. TSV is COPY's text format itself (also
// `\b`, `\f`, `\v`), its header from PostgreSQL 15 on. No DOM.

import { quoteText } from "../sql/quote.js";

/**
 * @typedef {import("../export/options.js").ExportFormat} ExportFormat
 * @typedef {import("../export/options.js").ExportOptions} ExportOptions
 * @typedef {{ format: "csv" | "text", delimiter: string, header: boolean, null: string }} Direct
 *   The server writes the file itself, in this COPY format.
 */

/** Delimiters the text format refuses besides line breaks and the backslash. */
const TEXT_REFUSED = /[.a-z0-9]/u;
const ASCII = /^[\x20-\x7e\t]$/u;

/**
 * The COPY that writes the file as it is, or undefined when the plugin's writer must.
 * @param {ExportFormat} format
 * @param {ExportOptions} o
 * @param {{ columns: string[], version: number }} meta `version`: server_version_num.
 * @returns {Direct | undefined}
 */
export function directOf(format, o, meta) {
  if (format !== "csv" && format !== "tsv") return undefined;
  if (o.lineEnding !== "lf" || o.encoding !== "utf-8") return undefined;
  const d = o.delimiter;
  if (!ASCII.test(d) || d === '"' || d === "\\") return undefined;
  if (/[\r\n]/u.test(o.null) || o.null.includes(d)) return undefined;
  if (format === "csv") {
    if (o.quote !== "needed" || o.null.includes('"') || meta.columns.length < 2) return undefined;
    // A column whose name is the NULL text: the server's header line would quote it.
    if (o.header && meta.columns.includes(o.null)) return undefined;
    return { format: "csv", delimiter: d, header: o.header, null: o.null };
  }
  if (TEXT_REFUSED.test(d)) return undefined;
  if (o.header && meta.version < 150000) return undefined;
  return { format: "text", delimiter: d, header: o.header, null: o.null };
}

/** A query's text without the spaces and semicolons that end it. */
export const bareQuery = (/** @type {string} */ text) => text.replace(/[\s;]+$/u, "");

/**
 * The COPY statement: `query` in parentheses (on a line of its own, so a comment at its end ends
 * there), in `direct`'s format, else the text format.
 * @param {string} query
 * @param {Direct} [direct]
 */
export function copySql(query, direct) {
  const body = `COPY (\n${bareQuery(query)}\n) TO STDOUT`;
  if (!direct) return body;
  const parts = [
    `FORMAT ${direct.format}`,
    `DELIMITER ${quoteText("postgresql", direct.delimiter)}`,
    `NULL ${quoteText("postgresql", direct.null)}`,
    ...(direct.header ? ["HEADER"] : []),
  ];
  return `${body} WITH (${parts.join(", ")})`;
}
