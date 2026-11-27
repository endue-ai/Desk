// What an export can be (PG-61): the six formats copy also writes, and four of the file's own (an
// .xlsx workbook, an HTML table, XML and the person's template), each format's options and their
// defaults, and options read from a command's arguments or the options dialog, checked once here
// so every writer can trust them. The defaults write exactly what the six formats wrote before.
// No DOM.

import { FORMATS } from "../results.js";
import { t } from "../strings/index.js";

/**
 * @typedef {import("../results.js").Format | "xlsx" | "html" | "xml" | "template"} ExportFormat
 * @typedef {"needed" | "always" | "never"} Quote
 * @typedef {"lf" | "crlf"} LineEnding
 * @typedef {"utf-8" | "utf-16le" | "utf-16be"} Encoding
 * @typedef {{
 *   delimiter: string, quote: Quote, header: boolean, null: string, lineEnding: LineEnding,
 *   encoding: Encoding, bom: boolean, table: string, batch: number,
 *   head: string, row: string, separator: string, foot: string,
 * }} ExportOptions
 *   `null` is the text a NULL is written as; `table` INSERT's and UPDATE's target as SQL ("" takes
 *   the result's own); `batch` the rows of one INSERT; `head`, `row`, `separator` and `foot` the
 *   template's parts, `row` holding `{{column}}`, `{{1}}` (the first column) and `{{#}}` (the row).
 */

/** @type {readonly ExportFormat[]} */
export const EXPORT_FORMATS = [...FORMATS, "xlsx", "html", "xml", "template"];

export const EXTENSIONS = /** @type {Record<ExportFormat, string>} */ ({
  tsv: "tsv",
  csv: "csv",
  json: "json",
  markdown: "md",
  insert: "sql",
  update: "sql",
  xlsx: "xlsx",
  html: "html",
  xml: "xml",
  template: "txt",
});

export const LABELS = /** @type {Record<ExportFormat, string>} */ ({
  tsv: t("export.options.tsv"),
  csv: t("export.options.csv"),
  json: t("export.options.json"),
  markdown: t("export.options.markdown"),
  insert: t("export.options.sqlInsert"),
  update: t("export.options.sqlUpdate"),
  xlsx: t("export.options.spreadsheetXlsx"),
  html: t("export.options.htmlTable"),
  xml: t("export.options.xml"),
  template: t("export.options.yourOwnTemplate"),
});

/** The options each format reads, in the dialog's order. */
export const FIELDS = /** @type {Record<ExportFormat, (keyof ExportOptions)[]>} */ ({
  csv: ["delimiter", "quote", "header", "null", "lineEnding", "encoding", "bom"],
  tsv: ["delimiter", "header", "null", "lineEnding", "encoding", "bom"],
  json: ["lineEnding", "encoding", "bom"],
  markdown: ["null", "lineEnding", "encoding", "bom"],
  insert: ["table", "batch", "lineEnding", "encoding", "bom"],
  update: ["table", "lineEnding", "encoding", "bom"],
  xlsx: ["header", "null"],
  html: ["header", "null", "lineEnding", "encoding", "bom"],
  xml: ["lineEnding", "encoding", "bom"],
  template: ["head", "row", "separator", "foot", "null", "lineEnding", "encoding", "bom"],
});

/** @type {ExportOptions} */
const BASE = {
  delimiter: ",",
  quote: "needed",
  header: true,
  null: "",
  lineEnding: "lf",
  encoding: "utf-8",
  bom: false,
  table: "",
  batch: 1,
  head: "",
  row: "",
  separator: "",
  foot: "",
};

/** A format's defaults: CSV as spreadsheets read it, TSV as COPY's text format writes it. */
export function defaultsOf(/** @type {ExportFormat} */ format) {
  if (format === "csv") return { ...BASE, lineEnding: /** @type {const} */ ("crlf") };
  if (format === "tsv") return { ...BASE, delimiter: "\t", header: false, null: "\\N" };
  if (format === "markdown" || format === "html") return { ...BASE, null: "NULL" };
  return { ...BASE };
}

/** Whether a format is one an export writes. */
export const isExportFormat = (/** @type {unknown} */ format) =>
  EXPORT_FORMATS.includes(/** @type {ExportFormat} */ (format));

const choice = (
  /** @type {string} */ name,
  /** @type {unknown} */ value,
  /** @type {readonly string[]} */ allowed,
) => {
  if (typeof value === "string" && allowed.includes(value)) return value;
  throw new Error(
    t("export.options.exportIsOneOf", { name: String(name), value: String(allowed.join(", ")) }),
  );
};
const text = (/** @type {string} */ name, /** @type {unknown} */ value, max = 4096) => {
  if (typeof value === "string" && value.length <= max) return value;
  throw new Error(
    t("export.options.exportIsTextOfCharactersAt", { name: String(name), max: String(max) }),
  );
};

/**
 * A format's options: its defaults, then what is given, each checked. Options the format does not
 * read are dropped. Throws a sentence the person reads.
 * @param {ExportFormat} format
 * @param {Record<string, unknown>} [given]
 * @returns {ExportOptions}
 */
export function optionsOf(format, given = {}) {
  const out = defaultsOf(format);
  const read = new Set(FIELDS[format]);
  for (const [key, value] of Object.entries(given ?? {})) {
    if (value === undefined || !read.has(/** @type {keyof ExportOptions} */ (key))) continue;
    if (key === "delimiter") {
      const d = text("the delimiter", value === "\\t" ? "\t" : value, 2);
      if (d.length !== 1 || /["\r\n\\]/u.test(d))
        throw new Error(t("export.options.exportTheDelimiterIsOneCharacter"));
      out.delimiter = d;
    } else if (key === "quote")
      out.quote = /** @type {Quote} */ (choice("quoting", value, ["needed", "always", "never"]));
    else if (key === "lineEnding")
      out.lineEnding = /** @type {LineEnding} */ (choice("the line ending", value, ["lf", "crlf"]));
    else if (key === "encoding")
      out.encoding = /** @type {Encoding} */ (
        choice("the encoding", value, ["utf-8", "utf-16le", "utf-16be"])
      );
    else if (key === "header" || key === "bom") {
      if (typeof value !== "boolean")
        throw new Error(t("export.options.exportIsTrueOrFalse", { key: String(key) }));
      out[key] = value;
    } else if (key === "batch") {
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 10_000)
        throw new Error(t("export.options.exportTheBatchSizeIsA"));
      out.batch = Number(value);
    } else if (key === "null") out.null = text("the text for NULL", value, 100);
    else if (key === "table") out.table = text("the table", value, 300).trim();
    else if (key === "head" || key === "row" || key === "separator" || key === "foot")
      out[key] = text(`the template's ${key}`, value);
  }
  if (format === "template" && !out.row)
    throw new Error(t("export.options.exportATemplateNeedsARow", { id: "{id}", name: "{name}" }));
  return out;
}
