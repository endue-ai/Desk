// CSV and TSV as their bytes: a concrete-syntax model, so a save changes only what was edited
// (ADR 0071). It keeps a UTF-8 BOM, where each field starts (its raw bytes, quotes and all), the
// delimiter, and each row's line ending (LF, CRLF, CR, or none at the very end); serialize writes
// the file back from those parts. The grammar is the grid's (csv.js parseCsv): RFC 4180, plus the
// text after a closing quote, which belongs to the field as Excel reads it. Delimiters, quotes and
// line breaks are ASCII, which no UTF-8 sequence contains, so the bytes are scanned as they are.

const QUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;
/** The line endings by their code in `endings`: none (the end of the file), LF, CRLF, CR. */
const ENDINGS = [[], [LF], [CR, LF], [CR]];

const encoder = new TextEncoder();
// Only the file's first bytes are its BOM: a field that starts with U+FEFF keeps it.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

/**
 * @typedef {{
 *   bytes: Uint8Array, bom: number, delimiter: number, rows: number,
 *   rowStarts: Uint32Array, starts: Uint32Array, endings: Uint8Array,
 * }} CsvSyntax `rowStarts[r]` is row r's first field (and `rowStarts[rows]` the number of
 * fields), `starts[f]` where field f's bytes start, `endings[r]` row r's line ending (ENDINGS).
 * A field ends at the next field's delimiter, or at its row's line ending.
 */

/** A typed array twice as long, with the first `used` items. */
function grown(/** @type {Uint32Array} */ array, /** @type {number} */ used) {
  const next = new Uint32Array(array.length * 2);
  next.set(array.subarray(0, used));
  return next;
}

/**
 * Read a CSV or TSV file's structure.
 * @param {Uint8Array} bytes the whole file
 * @param {string} delimiter one ASCII character: a comma, tab, semicolon or pipe
 * @returns {CsvSyntax}
 */
export function parseSyntax(bytes, delimiter) {
  const d = delimiter.charCodeAt(0);
  const n = bytes.length;
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  let starts = new Uint32Array(1024);
  let rowStarts = new Uint32Array(256);
  let endings = new Uint8Array(256);
  let fields = 0;
  let rows = 0;
  let p = bom;
  while (p < n) {
    if (rows + 1 >= rowStarts.length) {
      rowStarts = grown(rowStarts, rows);
      const more = new Uint8Array(rowStarts.length);
      more.set(endings);
      endings = more;
    }
    rowStarts[rows] = fields;
    for (;;) {
      if (fields === starts.length) starts = grown(starts, fields);
      starts[fields++] = p;
      if (bytes[p] === QUOTE) {
        // Up to the quote that is not doubled, or the end of the file.
        p++;
        while (p < n && !(bytes[p] === QUOTE && bytes[p + 1] !== QUOTE)) {
          p += bytes[p] === QUOTE ? 2 : 1;
        }
        if (p < n) p++;
      }
      while (p < n && bytes[p] !== d && bytes[p] !== CR && bytes[p] !== LF) p++;
      if (p < n && bytes[p] === d) p++;
      else break;
    }
    if (p >= n) endings[rows] = 0;
    else if (bytes[p] === CR && bytes[p + 1] === LF) endings[rows] = 2;
    else endings[rows] = bytes[p] === CR ? 3 : 1;
    p += ENDINGS[endings[rows] ?? 0]?.length ?? 0;
    rows++;
  }
  rowStarts[rows] = fields;
  return {
    bytes,
    bom,
    delimiter: d,
    rows,
    rowStarts: rowStarts.subarray(0, rows + 1),
    starts: starts.subarray(0, fields),
    endings: endings.subarray(0, rows),
  };
}

/** How many fields row r has. */
export const rowLength = (/** @type {CsvSyntax} */ s, /** @type {number} */ r) =>
  r >= 0 && r < s.rows ? (s.rowStarts[r + 1] ?? 0) - (s.rowStarts[r] ?? 0) : 0;

/** The field at row r, column c, or -1 when the file has none there. */
export function fieldIndex(/** @type {CsvSyntax} */ s, /** @type {number} */ r, c = 0) {
  return c >= 0 && c < rowLength(s, r) ? (s.rowStarts[r] ?? 0) + c : -1;
}

/** The row field f is in. */
function rowOf(/** @type {CsvSyntax} */ s, /** @type {number} */ f) {
  let lo = 0;
  let hi = s.rows - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((s.rowStarts[mid] ?? 0) <= f) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Where field f's bytes end: before the next field's delimiter, or its row's line ending. */
function endOf(/** @type {CsvSyntax} */ s, /** @type {number} */ f, r = rowOf(s, f)) {
  if (f + 1 < (s.rowStarts[r + 1] ?? 0)) return (s.starts[f + 1] ?? 0) - 1;
  const next = r + 1 < s.rows ? (s.starts[s.rowStarts[r + 1] ?? 0] ?? 0) : s.bytes.length;
  return next - (ENDINGS[s.endings[r] ?? 0]?.length ?? 0);
}

/** Field f's bytes as the file has them, quotes and all. */
export const rawField = (/** @type {CsvSyntax} */ s, /** @type {number} */ f) =>
  s.bytes.subarray(s.starts[f] ?? 0, endOf(s, f));

/** Whether field f is written in quotes. */
export const isQuoted = (/** @type {CsvSyntax} */ s, /** @type {number} */ f) =>
  s.bytes[s.starts[f] ?? 0] === QUOTE && (s.starts[f] ?? 0) < endOf(s, f);

/** Field f's text, as the grid shows it: without its quotes, a doubled quote as one. */
export function fieldText(/** @type {CsvSyntax} */ s, /** @type {number} */ f) {
  const raw = rawField(s, f);
  if (raw[0] !== QUOTE) return decoder.decode(raw);
  let close = 1;
  while (close < raw.length && !(raw[close] === QUOTE && raw[close + 1] !== QUOTE)) {
    close += raw[close] === QUOTE ? 2 : 1;
  }
  const inner = decoder.decode(raw.subarray(1, close)).replaceAll('""', '"');
  return inner + decoder.decode(raw.subarray(close + 1));
}

/**
 * The bytes a field holding `text` is written as: in quotes, with quotes doubled, when the field
 * was quoted or the text holds the delimiter, a quote or a line break (or starts with U+FEFF,
 * which would read as a BOM at the start of a file); as it is otherwise.
 * @param {string} text
 * @param {boolean} quoted
 * @param {number} delimiter
 */
export function fieldBytes(text, quoted, delimiter) {
  const needs = /^\uFEFF|["\r\n]/u.test(text) || text.includes(String.fromCharCode(delimiter));
  return encoder.encode(quoted || needs ? `"${text.replaceAll('"', '""')}"` : text);
}

/**
 * The file from its parts: the BOM, each row's fields between delimiters, and its line ending.
 * `edits` replaces fields by index with the bytes they are written as now.
 * @param {CsvSyntax} s
 * @param {ReadonlyMap<number, Uint8Array>} [edits]
 */
export function serialize(s, edits = new Map()) {
  const { bytes, rowStarts, starts, endings, delimiter } = s;
  const length = (/** @type {number} */ f, /** @type {number} */ r) =>
    edits.get(f)?.length ?? endOf(s, f, r) - (starts[f] ?? 0);
  let size = s.bom;
  for (let r = 0; r < s.rows; r++) {
    const [first, end] = [rowStarts[r] ?? 0, rowStarts[r + 1] ?? 0];
    size += end - first - 1 + (ENDINGS[endings[r] ?? 0]?.length ?? 0);
    for (let f = first; f < end; f++) size += length(f, r);
  }
  const out = new Uint8Array(size);
  let at = 0;
  const copy = (/** @type {number} */ from, /** @type {number} */ to) => {
    if (to - from > 32) out.set(bytes.subarray(from, to), at);
    else for (let i = from; i < to; i++) out[at + i - from] = bytes[i] ?? 0;
    at += to - from;
  };
  copy(0, s.bom);
  for (let r = 0; r < s.rows; r++) {
    const [first, end] = [rowStarts[r] ?? 0, rowStarts[r + 1] ?? 0];
    for (let f = first; f < end; f++) {
      if (f > first) out[at++] = delimiter;
      const raw = edits.get(f);
      if (raw) {
        out.set(raw, at);
        at += raw.length;
      } else copy(starts[f] ?? 0, endOf(s, f, r));
    }
    for (const byte of ENDINGS[endings[r] ?? 0] ?? []) out[at++] = byte;
  }
  return out;
}
