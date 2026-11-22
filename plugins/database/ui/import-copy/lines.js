// The line-shaped files an import reads as they stream in (PG-60): PostgreSQL's text format (TSV:
// fields split by the delimiter, `\N` or the person's NULL text for NULL, backslash escapes), and
// JSON lines (one object or array per line: an object's values by the columns its keys named in the
// sample, an array's in order; nested values as their JSON). Each is fed text cut anywhere and
// answers the lines it has whole; a blank line is no record. Pure.

/**
 * @typedef {import("./csv.js").Row} Row
 * @typedef {import("./csv.js").RowReader} RowReader
 */

const ESCAPES = /** @type {Record<string, string>} */ ({
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\\": "\\",
});

/** Lines of `text` whole, the rest kept for the next piece. */
function lineSplitter(/** @type {(line: string) => Row | undefined} */ onLine) {
  let rest = "";
  /** @type {Row[]} */
  let out = [];
  const take = (/** @type {string} */ raw) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "") return;
    const row = onLine(line);
    if (row) out.push(row);
  };
  /** @type {RowReader} */
  const reader = {
    push(text) {
      out = [];
      let start = 0;
      const all = rest + text;
      for (let at = all.indexOf("\n"); at >= 0; at = all.indexOf("\n", start)) {
        take(all.slice(start, at));
        start = at + 1;
      }
      rest = all.slice(start);
      return out;
    },
    end() {
      out = [];
      if (rest !== "") take(rest);
      rest = "";
      return out;
    },
  };
  return reader;
}

/**
 * PostgreSQL's text format.
 * @param {{ delimiter: string, nullText: string, trim: boolean }} options
 * @returns {RowReader}
 */
export function createTextReader({ delimiter, nullText, trim }) {
  const sep = delimiter || "\t";
  const none = nullText || "\\N";
  const unescaped = (/** @type {string} */ v) =>
    v.includes("\\") ? v.replace(/\\(.)/gu, (_, c) => ESCAPES[c] ?? c) : v;
  return lineSplitter((line) =>
    line.split(sep).map((raw) => {
      const v = trim ? raw.trim() : raw;
      return v === none ? null : unescaped(v);
    }),
  );
}

/** A JSON value as a cell: NULL, text, or the JSON of an object or array. */
export const cellOf = (/** @type {unknown} */ value) =>
  value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

/**
 * JSON lines; `columns` are the keys an object's values are read by (the sample's, in order).
 * @param {{ columns: string[], trim: boolean, line?: number }} options `line` is the file's line
 *   the first one fed is, for the error a bad line throws.
 * @returns {RowReader}
 */
export function createJsonLinesReader({ columns, trim, line = 1 }) {
  let at = line - 1;
  const text = (/** @type {unknown} */ v) => {
    const cell = cellOf(v);
    return trim && cell !== null ? cell.trim() : cell;
  };
  return lineSplitter((raw) => {
    at++;
    /** @type {unknown} */
    let value;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Line ${at} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (Array.isArray(value)) return value.map(text);
    if (value !== null && typeof value === "object") {
      const object = /** @type {Record<string, unknown>} */ (value);
      return columns.map((c) => text(object[c]));
    }
    return [text(value)];
  });
}

/** The keys of the objects in JSON lines, in the order first seen; empty for arrays. */
export function keysOf(/** @type {string} */ sample) {
  const keys = new Set();
  for (const line of sample.split("\n")) {
    try {
      const value = JSON.parse(line);
      if (value !== null && typeof value === "object" && !Array.isArray(value))
        for (const key of Object.keys(value)) keys.add(key);
    } catch {
      // A line the sample cut, or not JSON: the import says so when it reaches it.
    }
  }
  return /** @type {string[]} */ ([...keys]);
}
