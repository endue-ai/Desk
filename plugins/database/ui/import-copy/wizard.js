// What the import wizard holds for a PostgreSQL connection (PG-60), without the DOM: how the file
// reads (encoding, delimiter, quote, escape, the NULL text, trimming, rows to skip, the date order),
// where its rows go (a table that exists, mapped as today, or a new one whose columns and types are
// inferred from the sample and corrected by the person), what an error does (stop and roll back, or
// skip the row into a reject file), and one transaction or batches. From it: the reading options,
// the job the reader runs, the COPY statement and the CREATE TABLE. Pure.

import { quoteName } from "../sql/quote.js";
import { createTable, inferColumns, tableFromFile } from "./infer.js";

/**
 * @typedef {import("./transform.js").CopyFormat} CopyFormat
 * @typedef {import("./infer.js").NewColumn} NewColumn
 * @typedef {import("./infer.js").DateOrder} DateOrder
 * @typedef {{
 *   encoding: string, delimiter: string, quote: string, escape: string, nullText: string,
 *   trim: boolean, skip: number, dateOrder: DateOrder,
 * }} Options
 * @typedef {{
 *   format: CopyFormat, options: Options, target: "existing" | "new", newTable: string,
 *   newColumns: NewColumn[], inferred: boolean, onError: "stop" | "skip", batch: number,
 * }} CopyState
 * @typedef {{ options?: Partial<Options>, target?: "existing" | "new", newTable?: string,
 *   column?: [number, Partial<NewColumn>], onError?: "stop" | "skip", batch?: number }} CopyChange
 */

/** The encodings the form lists; the field takes any other the frame's TextDecoder reads. */
export const ENCODINGS = [
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1252",
  "iso-8859-1",
  "iso-8859-15",
  "windows-1251",
  "shift_jis",
  "euc-jp",
  "euc-kr",
  "gbk",
  "big5",
];

/** The format an import reads a file's name as. @returns {CopyFormat | undefined} */
export function copyFormatOf(/** @type {string} */ path) {
  const ext = /\.([a-z]+)$/iu.exec(path)?.[1]?.toLowerCase();
  if (ext === "csv" || ext === "tsv" || ext === "json" || ext === "xlsx") return ext;
  if (ext === "jsonl" || ext === "ndjson") return "jsonl";
  return undefined;
}

/** A new wizard's state for a file of `format`. @returns {CopyState} */
export function copyState(/** @type {CopyFormat} */ format, /** @type {string} */ file) {
  return {
    format,
    options: {
      encoding: "utf-8",
      delimiter: format === "tsv" ? "\t" : ",",
      quote: '"',
      escape: '"',
      nullText: format === "tsv" ? "\\N" : "",
      trim: false,
      skip: 0,
      dateOrder: "",
    },
    target: "existing",
    newTable: tableFromFile(file),
    newColumns: [],
    inferred: false,
    onError: "stop",
    batch: 0,
  };
}

/** The options the reader reads with. */
export function readOptions(/** @type {CopyState} */ state, /** @type {boolean} */ header) {
  return { format: state.format, header, ...state.options };
}

/**
 * Apply a change; answers whether the file must be read again.
 * @param {CopyState} state
 * @param {CopyChange} change
 */
export function changeCopy(state, change) {
  let reread = false;
  if (change.options) {
    const next = { ...state.options, ...change.options };
    next.skip = Math.max(0, Math.floor(Number(next.skip) || 0));
    reread = JSON.stringify(next) !== JSON.stringify(state.options);
    // The date order changes what the sample's dates read as: the types are inferred again.
    if (next.dateOrder !== state.options.dateOrder) state.inferred = false;
    state.options = next;
  }
  if (change.target) state.target = change.target;
  if (change.newTable !== undefined) state.newTable = change.newTable;
  if (change.column) {
    const [index, part] = change.column;
    const column = state.newColumns[index];
    if (column) state.newColumns[index] = { ...column, ...part };
  }
  if (change.onError) state.onError = change.onError;
  if (change.batch !== undefined) state.batch = Math.max(0, Math.floor(Number(change.batch) || 0));
  return reread;
}

/** Infer the new table's columns from the sample, unless the person corrected them already. */
export function inferInto(
  /** @type {CopyState} */ state,
  /** @type {{ columns: string[], rows: (string | null)[][] }} */ table,
) {
  if (state.inferred && state.newColumns.length === table.columns.length) return;
  state.newColumns = inferColumns(table.columns, table.rows, state.options.dateOrder);
  state.inferred = true;
}

/**
 * The target's columns and, for each, the file column it takes.
 * @param {CopyState} state
 * @param {(string | null)[]} mapping An existing table's column for each file column.
 */
export function targetColumns(state, mapping) {
  /** @type {Array<{ name: string, from: number }>} */
  const out = [];
  if (state.target === "new")
    state.newColumns.forEach((c, from) => {
      if (c.name.trim()) out.push({ name: c.name.trim(), from });
    });
  else
    mapping.forEach((name, from) => {
      if (name) out.push({ name, from });
    });
  return out;
}

/**
 * The statements an import runs, or the sentence why it cannot.
 * @param {CopyState} state
 * @param {string} table The target's qualified name, as SQL.
 * @param {Array<{ name: string, from: number }>} columns
 */
export function copyStatements(state, table, columns) {
  if (columns.length === 0)
    return {
      problem:
        state.target === "new"
          ? "Give at least one column a name."
          : "Map at least one column to the table.",
    };
  /** @type {string | undefined} */
  let create;
  if (state.target === "new") {
    const made = createTable(table, state.newColumns);
    if ("problem" in made) return { problem: made.problem };
    create = made.sql;
  }
  const list = columns.map((c) => quoteName("postgresql", c.name)).join(", ");
  const copy = `COPY ${table} (${list}) FROM STDIN`;
  const order = state.options.dateOrder;
  const begin = order ? [`SET LOCAL DateStyle = 'ISO, ${order}'`] : [];
  return { copy, begin, ...(create ? { create } : {}) };
}

/**
 * The job the reader runs for the whole file.
 * @param {CopyState} state
 * @param {boolean} header
 * @param {string[]} keys
 * @param {Array<{ from: number }>} columns
 * @returns {import("./transform.js").Job}
 */
export function jobOf(state, header, keys, columns) {
  return { ...readOptions(state, header), keys, pick: columns.map((c) => c.from) };
}

/**
 * What the view draws of the COPY part of the wizard.
 * @param {CopyState} state
 * @param {{ size: number, progress: import("./source.js").Progress | null,
 *   server: { columns: string[], rows: (string | null)[][] } | { error: string } | null,
 *   checking: boolean }} live
 */
export function copyModel(state, live) {
  return {
    format: state.format,
    options: { ...state.options },
    target: state.target,
    newTable: state.newTable,
    newColumns: state.newColumns.map((c) => ({ ...c })),
    onError: state.onError,
    batch: state.batch,
    size: live.size,
    progress: live.progress ? { ...live.progress } : null,
    server: live.server,
    checking: live.checking,
  };
}
