// A file's bytes as the lines of a COPY in PostgreSQL's text format (PG-60): decoded in the person's
// encoding as they come (a character cut between two pieces waits for the rest), read as records by
// the file's format (csv.js, lines.js; a `.json` array and an `.xlsx` whole, at the end), the rows to
// skip and the header line left out, each row's values put in the order of the COPY's columns
// (`pick`, the file's column for each), and each row one line: tab between values, `\N` for NULL,
// backslash, tab, newline and carriage return escaped. `take` hands out the lines in pieces, by
// bytes and rows at most, so a COPY's chunk and a batch's rows stay bounded. Pure: an `.xlsx` is
// read by the reader the caller gives (the vendored one, in the worker).

import { readTable } from "../import.js";
import { t } from "../strings/index.js";
import { createCsvReader } from "./csv.js";
import { createJsonLinesReader, createTextReader } from "./lines.js";

/**
 * @typedef {import("./csv.js").Row} Row
 * @typedef {"csv" | "tsv" | "jsonl" | "json" | "xlsx"} CopyFormat
 * @typedef {{
 *   format: CopyFormat, encoding: string, delimiter: string, quote: string, escape: string,
 *   nullText: string, trim: boolean, header: boolean, skip: number, keys: string[], pick: number[],
 * }} Job
 *   `keys` are a JSON lines file's object keys in column order; `pick` the file column each of the
 *   COPY's columns takes.
 * @typedef {(bytes: Uint8Array) => Row[]} XlsxReader
 * @typedef {{ text: string, rows: number, bytes: number }} Taken
 */

const SPECIAL = /[\\\t\n\r]/u;
const WIDE = /[^ -~\t\n\r]/u;
const encoder = new TextEncoder();

/** One value as COPY's text format writes it. */
const textOf = (/** @type {string | null | undefined} */ v) =>
  v === null || v === undefined
    ? "\\N"
    : SPECIAL.test(v)
      ? v.replace(/[\\\t\n\r]/gu, (c) =>
          c === "\\" ? "\\\\" : c === "\t" ? "\\t" : c === "\n" ? "\\n" : "\\r",
        )
      : v;

/** A row as one line of COPY's text format, its values in `pick`'s order. */
export function copyLine(/** @type {Row} */ row, /** @type {number[]} */ pick) {
  let line = "";
  for (let k = 0; k < pick.length; k++) {
    if (k > 0) line += "\t";
    line += textOf(row[/** @type {number} */ (pick[k])]);
  }
  return `${line}\n`;
}

/** The bytes a line takes in UTF-8. */
const sizeOf = (/** @type {string} */ line) =>
  WIDE.test(line) ? encoder.encode(line).length : line.length;

/** The decoder of an encoding, or the sentence that refuses it. */
export function decoderOf(/** @type {string} */ encoding) {
  try {
    return new TextDecoder(encoding || "utf-8");
  } catch {
    throw new Error(
      t("importCopy.transform.theEncodingIsNotOneThe", { encoding: String(encoding) }),
    );
  }
}

/**
 * @param {Job} job
 * @param {{ xlsx?: XlsxReader }} [readers]
 */
export function createTransform(job, readers = {}) {
  const decoder = decoderOf(job.encoding);
  const whole = job.format === "json" || job.format === "xlsx";
  const reader =
    job.format === "csv"
      ? createCsvReader(job)
      : job.format === "tsv"
        ? createTextReader(job)
        : job.format === "jsonl"
          ? createJsonLinesReader({ columns: job.keys, trim: job.trim })
          : undefined;
  /** @type {Uint8Array[]} */
  const parts = [];
  // A JSON array's header and JSON lines of objects name their columns without a line of names.
  const named = job.header && job.format !== "json" && !(job.format === "jsonl" && job.keys.length);
  let leftOut = job.skip + (named ? 1 : 0);
  /** @type {string[]} */
  let queue = [];
  let head = 0;
  let ended = false;

  const add = (/** @type {Row[]} */ rows) => {
    for (const row of rows) {
      if (leftOut > 0) {
        leftOut--;
        continue;
      }
      queue.push(copyLine(row, job.pick));
    }
  };
  /** A whole file's rows: an `.xlsx` by its reader, a JSON array as the INSERT import reads it. */
  const wholeRows = () => {
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }
    parts.length = 0;
    if (job.format === "xlsx") {
      if (!readers.xlsx) throw new Error(t("importCopy.transform.anXlsxFileIsReadIn"));
      return readers.xlsx(bytes);
    }
    return readTable(decoder.decode(bytes), "json", { header: job.header }).rows;
  };

  return {
    /** Feed the file's next bytes; null at its end. */
    feed(/** @type {Uint8Array | null} */ bytes) {
      if (ended) return;
      if (bytes === null) {
        ended = true;
        if (whole) add(wholeRows());
        else if (reader) add([...reader.push(decoder.decode()), ...reader.end()]);
        return;
      }
      if (whole) parts.push(bytes);
      else if (reader) add(reader.push(decoder.decode(bytes, { stream: true })));
    },
    /**
     * The lines ready, up to `maxBytes` of UTF-8 (one line at least) and `maxRows`.
     * @returns {Taken}
     */
    take(/** @type {number} */ maxBytes, /** @type {number} */ maxRows = Infinity) {
      let text = "";
      let bytes = 0;
      let rows = 0;
      while (head < queue.length && rows < maxRows) {
        const line = /** @type {string} */ (queue[head]);
        const size = sizeOf(line);
        if (rows > 0 && bytes + size > maxBytes) break;
        text += line;
        bytes += size;
        rows++;
        head++;
      }
      if (head > 4096 && head * 2 > queue.length) {
        queue = queue.slice(head);
        head = 0;
      }
      return { text, rows, bytes };
    },
    /** Lines wait to be taken. */
    ready: () => head < queue.length,
    ended: () => ended,
  };
}

/** Base64 as bytes. */
export function base64Bytes(/** @type {string} */ text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * One turn of a transform, as the worker and the frame both run it: feed the next piece (base64,
 * null at the file's end, undefined for none), then take what is ready.
 * @param {ReturnType<typeof createTransform>} transform
 * @param {{ feed?: string | null, maxBytes: number, maxRows?: number }} turn
 */
export function exchange(transform, { feed, maxBytes, maxRows }) {
  if (feed !== undefined) transform.feed(feed === null ? null : base64Bytes(feed));
  const taken = transform.take(maxBytes, maxRows ?? Infinity);
  return { ...taken, ready: transform.ready(), ended: transform.ended() };
}
