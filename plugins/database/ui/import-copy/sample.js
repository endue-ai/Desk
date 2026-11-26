// What the import wizard shows of a large file (PG-60): the records of its first bytes (1 MiB; the
// whole of an `.xlsx`, which can only be read whole), read with the person's options as the COPY
// will read them, the last record left out when the sample cut it, and from them the file's columns
// (the header line's names, a JSON line's keys, else `column N`) and its first rows. Pure.

import { readTable } from "../import.js";
import { t } from "../strings/index.js";
import { createCsvReader } from "./csv.js";
import { createJsonLinesReader, createTextReader, keysOf } from "./lines.js";
import { decoderOf } from "./transform.js";

/**
 * @typedef {import("./csv.js").Row} Row
 * @typedef {import("./transform.js").Job} Job
 * @typedef {import("./transform.js").XlsxReader} XlsxReader
 * @typedef {Omit<Job, "pick" | "keys">} ReadOptions
 * @typedef {{ records: Row[], keys: string[] }} Sample
 */

/** The bytes a sample reads from the start of a file. */
export const SAMPLE_BYTES = 1024 * 1024;
/** The records a sample keeps, which the types are inferred from. */
export const SAMPLE_ROWS = 1000;

/**
 * The records of a file's first bytes (`whole` when they are the whole file).
 * @param {ReadOptions} options
 * @param {Uint8Array} bytes
 * @param {boolean} whole
 * @param {{ xlsx?: XlsxReader }} [readers]
 * @returns {Sample}
 */
export function sampleOf(options, bytes, whole, readers = {}) {
  const limit = SAMPLE_ROWS + options.skip + 1;
  if (options.format === "xlsx") {
    if (!readers.xlsx) throw new Error(t("importCopy.sample.anXlsxFileIsReadIn"));
    return { records: readers.xlsx(bytes).slice(0, limit), keys: [] };
  }
  const text = decoderOf(options.encoding).decode(bytes);
  if (options.format === "json") {
    if (!whole) throw new Error(t("importCopy.sample.aJsonArrayIsReadWhole"));
    const table = readTable(text, "json", { header: options.header });
    return { records: table.rows.slice(0, limit), keys: table.columns };
  }
  const keys = options.format === "jsonl" ? keysOf(text) : [];
  const reader =
    options.format === "csv"
      ? createCsvReader(options)
      : options.format === "tsv"
        ? createTextReader(options)
        : createJsonLinesReader({ columns: keys, trim: options.trim });
  let records;
  try {
    records = reader.push(text);
    if (whole) records.push(...reader.end());
  } catch (error) {
    // A JSON line the sample cut off reads as no line.
    if (whole) throw error;
    records = [];
  }
  return { records: records.slice(0, limit), keys };
}

/**
 * The file's columns and first rows, from its sampled records.
 * @param {Sample} sample
 * @param {{ format: Job["format"], header: boolean, skip: number }} options
 * @returns {{ columns: string[], rows: Row[] }}
 */
export function tableOf({ records, keys }, { format, header, skip }) {
  const kept = records.slice(skip);
  // A JSON array's columns came with it; JSON lines of objects are named by their keys.
  const objects = format === "json" || (format === "jsonl" && keys.length > 0);
  const named = header && !objects;
  const [first = [], ...rest] = named ? kept : [[], ...kept];
  const names = objects ? keys : first;
  const width = Math.max(names.length, ...rest.map((r) => r.length), 0);
  const columns = Array.from({ length: width }, (_, i) => names[i] || `column ${i + 1}`);
  return { columns, rows: rest.map((r) => columns.map((_, i) => r[i] ?? null)) };
}
