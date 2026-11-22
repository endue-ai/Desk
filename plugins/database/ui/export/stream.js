// A text format written in pieces (PG-64): what goes before the rows, the rows a batch at a time,
// and what goes after, so that the pieces joined are exactly what exportText writes for every row at
// once (text.js). CSV, TSV and UPDATE are written a batch at a time as they are; INSERT keeps the
// rows of an unfinished batch for the next; Markdown, HTML and XML take their head and foot from an
// empty export; JSON and the template are joined here. JSON keeps a column's values numbers when its
// type is a number type (the result's export looks at its values, which a whole export never holds).
// No DOM.

import { exportText, template } from "./text.js";

/**
 * @typedef {import("./options.js").ExportFormat} ExportFormat
 * @typedef {import("./options.js").ExportOptions} ExportOptions
 * @typedef {(string | null)[]} Row
 * @typedef {{ columns: string[], oids: number[], types: string[], table?: string }} Meta
 *   A whole export's columns, their type OIDs and names, and the table its SQL formats name.
 * @typedef {{ head(): string, rows(rows: Row[]): string, end(): string }} TextWriter
 */

/** PostgreSQL's number types: int8, int2, int4, oid, float4, float8, numeric. */
export const NUMBER_OIDS = new Set([20, 21, 23, 26, 700, 701, 1700]);

/**
 * @param {Exclude<ExportFormat, "xlsx">} format
 * @param {ExportOptions} o
 * @param {Meta} meta
 * @returns {TextWriter}
 */
export function textWriter(format, o, meta) {
  const eol = o.lineEnding === "crlf" ? "\r\n" : "\n";
  const base = {
    dialect: /** @type {const} */ ("postgresql"),
    types: meta.types,
    ...(meta.table ? { table: meta.table } : {}),
  };
  const whole = (/** @type {Row[]} */ rows, options = o) =>
    exportText(
      { columns: meta.columns, rows, truncated: false, types: meta.oids },
      format,
      options,
      base,
    );
  if (format === "csv" || format === "tsv")
    return {
      head: () => (o.header ? whole([]) : ""),
      rows: (rows) => whole(rows, { ...o, header: false }),
      end: () => "",
    };
  if (format === "update") return { head: () => "", rows: (rows) => whole(rows), end: () => "" };
  if (format === "insert") {
    /** @type {Row[]} */
    let held = [];
    return {
      head: () => "",
      rows(rows) {
        held = held.concat(rows);
        const n = held.length - (held.length % o.batch);
        if (n === 0) return "";
        const out = whole(held.slice(0, n));
        held = held.slice(n);
        return out;
      },
      end: () => (held.length ? whole(held) : ""),
    };
  }
  if (format === "markdown" || format === "html" || format === "xml") {
    const empty = whole([]);
    const cut =
      format === "markdown"
        ? empty.length
        : empty.lastIndexOf(format === "html" ? "</tbody>" : "</rows>");
    const head = empty.slice(0, cut);
    const foot = empty.slice(cut);
    return {
      head: () => head,
      rows: (rows) => {
        if (!rows.length) return "";
        const text = whole(rows);
        return text.slice(head.length, text.length - foot.length);
      },
      end: () => foot,
    };
  }
  if (format === "json") return jsonWriter(meta, eol);
  return templateWriter(meta, o, eol);
}

/** JSON's array of objects, an object a row, indented as JSON.stringify(rows, null, 2) is. */
function jsonWriter(/** @type {Meta} */ meta, /** @type {string} */ eol) {
  const numeric = meta.columns.map((_, c) => NUMBER_OIDS.has(meta.oids[c] ?? 0));
  let count = 0;
  const value = (/** @type {string | null} */ v, /** @type {number} */ c) => {
    if (v === null || !numeric[c]) return v;
    const n = Number(v);
    return String(n) === v ? n : v;
  };
  return {
    head: () => "",
    rows(rows) {
      let out = "";
      for (const row of rows) {
        const object = Object.fromEntries(row.map((v, c) => [meta.columns[c], value(v, c)]));
        const text = JSON.stringify(object, null, 2).split("\n");
        out += `${count++ ? `,${eol}` : `[${eol}`}${text.map((line) => `  ${line}`).join(eol)}`;
      }
      return out;
    },
    end: () => (count ? `${eol}]${eol}` : `[]${eol}`),
  };
}

/** The template: its head, each row with the separator between rows, its foot. */
function templateWriter(
  /** @type {Meta} */ meta,
  /** @type {ExportOptions} */ o,
  /** @type {string} */ eol,
) {
  const body = { ...o, head: "", foot: "" };
  let count = 0;
  return {
    head: () => (o.head ? `${o.head}${eol}` : ""),
    rows(rows) {
      if (!rows.length) return "";
      const lines = template(meta.columns, rows, body, count);
      const before = count ? `${o.separator}${eol}` : "";
      count += rows.length;
      return before + lines.join(eol);
    },
    end: () => `${count ? eol : ""}${o.foot ? `${o.foot}${eol}` : ""}`,
  };
}
