// A file dropped to import into a table (DB-23), without the DOM: CSV read as databases write it
// (quotes, CRLF, a BOM; an unquoted empty field is NULL, a quoted one ''), TSV in the text format this
// plugin copies (\N for NULL, \t \n \r \\ escaped), JSON rows (objects by key, or arrays), the file's
// columns matched to the table's by name, and the INSERT statements of one transaction, several rows
// each. The SQL goes to the client as its arguments, so one import is capped (MAX_IMPORT_BYTES).

import { literal } from "./edit/values.js";
import { quoteName } from "./sql/quote.js";

/**
 * @typedef {import("./sql/lexer.js").Dialect} Dialect
 * @typedef {"csv" | "tsv" | "json"} Format
 * @typedef {{ columns: string[], rows: (string | null)[][] }} Table
 */

/** The SQL one import may send: the clients get it as arguments, which the OS limits. */
export const MAX_IMPORT_BYTES = 512 * 1024;
/** One statement's SQL at most (Linux takes 128 KiB per argument). */
const STATEMENT_BYTES = 64 * 1024;
const DELIMITERS = [",", ";", "\t", "|"];

/** The format a file's name says, if it is one the import reads. @returns {Format | undefined} */
export function formatOf(/** @type {string} */ path) {
  const ext = /\.([a-z]+)$/iu.exec(path)?.[1]?.toLowerCase();
  return ext === "csv" || ext === "tsv" || ext === "json" ? ext : undefined;
}

/** The delimiter the first line uses most, outside quotes; a comma when it says nothing. */
function sniff(/** @type {string} */ text) {
  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [",", 0];
  return n > 0 ? best : ",";
}

/**
 * CSV as RFC 4180 writes it. Blank lines are skipped.
 * @param {string} text
 * @param {string} [delimiter] Found from the first line when absent.
 */
export function parseCsv(text, delimiter) {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  const sep = delimiter ?? sniff(body);
  /** @type {(string | null)[][]} */
  const rows = [];
  /** @type {(string | null)[]} */
  let row = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  const endField = () => {
    row.push(field === "" && !wasQuoted ? null : field);
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== null) rows.push(row);
    row = [];
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (body[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && field === "" && !wasQuoted) {
      quoted = true;
      wasQuoted = true;
    } else if (ch === sep) endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      endRow();
    } else field += ch;
  }
  if (quoted) throw new Error("The file ends inside a quoted field.");
  if (field !== "" || wasQuoted || row.length > 0) endRow();
  return { rows, delimiter: sep };
}

/** TSV in the text format: \N is NULL, \t \n \r and \\ are escaped. */
function parseTsv(/** @type {string} */ text) {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  const escapes = /** @type {Record<string, string>} */ ({ t: "\t", n: "\n", r: "\r", "\\": "\\" });
  return body
    .split(/\r?\n/u)
    .filter((line) => line !== "")
    .map((line) =>
      line
        .split("\t")
        .map((v) => (v === "\\N" ? null : v.replace(/\\([tnr\\])/gu, (_, c) => escapes[c] ?? c))),
    );
}

/** A JSON value as a cell: NULL, text, or the JSON of an object or array. */
const cellOf = (/** @type {unknown} */ value) =>
  value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

/** JSON rows: objects (their keys, in the order first seen, are the columns) or arrays. */
function parseJson(/** @type {string} */ text, /** @type {boolean} */ header) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`The file is not JSON: ${error instanceof Error ? error.message : error}.`);
  }
  // A db/rows value, as the plugin drags rows: { columns, rows }.
  const shaped = /** @type {{ columns?: unknown, rows?: unknown }} */ (data ?? {});
  if (!Array.isArray(data) && Array.isArray(shaped.columns) && Array.isArray(shaped.rows))
    data = [shaped.columns, ...shaped.rows];
  else if (!Array.isArray(data)) throw new Error("The JSON file must hold an array of rows.");
  const list = /** @type {unknown[]} */ (data);
  if (list.every(Array.isArray)) {
    const rows = /** @type {unknown[][]} */ (list).map((r) => r.map(cellOf));
    return header ? rows : [[], ...rows];
  }
  if (!list.every((r) => r !== null && typeof r === "object" && !Array.isArray(r)))
    throw new Error("The JSON file must hold an array of rows: objects, or arrays.");
  const objects = /** @type {Record<string, unknown>[]} */ (list);
  const columns = [...new Set(objects.flatMap((o) => Object.keys(o)))];
  return [columns, ...objects.map((o) => columns.map((c) => cellOf(o[c])))];
}

/**
 * A file's text as columns and rows. The first row names the columns when `header` is true (JSON
 * objects always do); a name left empty, or no header, reads `column N`. Short rows end in NULL.
 * @param {string} text
 * @param {Format} format
 * @param {{ header?: boolean }} [options]
 * @returns {Table}
 */
export function readTable(text, format, { header = true } = {}) {
  const all =
    format === "json"
      ? parseJson(text, header)
      : format === "tsv"
        ? parseTsv(text)
        : parseCsv(text).rows;
  // JSON's first row is its header already (empty for arrays read without one).
  const [first = [], ...rows] = format === "json" || header ? all : [[], ...all];
  const width = Math.max(first.length, ...rows.map((r) => r.length), 0);
  const columns = Array.from({ length: width }, (_, i) => first[i] || `column ${i + 1}`);
  return { columns, rows: rows.map((r) => columns.map((_, i) => r[i] ?? null)) };
}

const norm = (/** @type {string} */ name) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The table column each file column goes to, by name (case, spaces and underscores aside); null
 * leaves a file column out. A table column takes one file column at most.
 * @param {string[]} fileColumns
 * @param {Array<{ name: string }>} tableColumns
 * @returns {(string | null)[]}
 */
export function autoMap(fileColumns, tableColumns) {
  const used = new Set();
  return fileColumns.map((name) => {
    const found = tableColumns.find((c) => !used.has(c.name) && norm(c.name) === norm(name));
    if (!found) return null;
    used.add(found.name);
    return found.name;
  });
}

/**
 * The INSERTs of an import, in the table's column order, several rows each, every value a literal
 * of its column's type.
 * @param {{ dialect: Dialect, table: string, columns: Array<{ name: string, type: string }>,
 *   mapping: (string | null)[], rows: (string | null)[][], batch?: number }} input
 * @returns {string[]}
 */
export function importStatements({ dialect, table, columns, mapping, rows, batch = 500 }) {
  const used = columns.filter((c) => mapping.includes(c.name));
  if (used.length === 0) throw new Error("Map at least one column to the table.");
  const from = used.map((c) => mapping.indexOf(c.name));
  const head = `INSERT INTO ${table} (${used.map((c) => quoteName(dialect, c.name)).join(", ")}) VALUES `;
  /** @type {string[]} */
  const statements = [];
  /** @type {string[]} */
  let values = [];
  let bytes = 0;
  const flush = () => {
    if (values.length) statements.push(`${head}${values.join(", ")}`);
    values = [];
    bytes = 0;
  };
  for (const row of rows) {
    const tuple = `(${from.map((i, k) => literal(dialect, row[i] ?? null, used[k]?.type ?? "")).join(", ")})`;
    if (values.length >= batch || (values.length > 0 && bytes + tuple.length > STATEMENT_BYTES))
      flush();
    values.push(tuple);
    bytes += tuple.length + 2;
  }
  flush();
  const total = statements.reduce((sum, s) => sum + new TextEncoder().encode(s).length + 2, 0);
  if (total > MAX_IMPORT_BYTES)
    throw new Error(
      `This import makes ${Math.ceil(total / 1024)} KiB of SQL and one run takes ${MAX_IMPORT_BYTES / 1024} KiB at most: split the file, or use the engine's own import (COPY, LOAD DATA, .import) in the terminal.`,
    );
  return statements;
}
