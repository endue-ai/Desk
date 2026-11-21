// Text pasted into the grid as rows of values (PG-43): the grid's own copy (tab-separated with
// PostgreSQL's text escapes, \N for NULL: results.js), a spreadsheet's tab-separated text (a field
// with a tab, a line break or a quote is quoted, "" a quote), CSV when every line splits into the
// same number of fields (an unquoted empty field is NULL, as COPY reads CSV), and one value. One
// final line break is dropped. No imports: the paste worker loads this alone (grid/paste-worker.js).

/**
 * @typedef {"value" | "tsv" | "copy" | "csv"} PasteFormat
 * @typedef {{ rows: (string | null)[][], format: PasteFormat }} Pasted
 */

const ESCAPES = /** @type {Record<string, string>} */ ({ t: "\t", n: "\n", r: "\r", "\\": "\\" });

/** A field of the grid's own copy: \N is NULL, \t \n \r \\ what they stand for. */
function copyField(/** @type {string} */ field) {
  if (field === "\\N") return null;
  if (!field.includes("\\")) return field;
  return field.replace(/\\(.)/gsu, (all, c) => ESCAPES[c] ?? all);
}

/**
 * Split text into rows of fields by a separator, reading a field that starts with a quote as quoted
 * (to its closing quote, "" a quote) when the closing quote ends the field; any other quote is text.
 * A line ends at \n or \r\n. `quoted` gets each field's quoting, for CSV's NULL.
 * @param {string} text
 * @param {string} sep
 * @param {boolean[][]} [quoted]
 */
function split(text, sep, quoted) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  /** @type {boolean[]} */
  let marks = [];
  let at = 0;
  const ends = (/** @type {number} */ i) =>
    i >= text.length || text[i] === sep || text[i] === "\n" || text.startsWith("\r\n", i);
  while (at <= text.length) {
    let value = "";
    let wasQuoted = false;
    if (text[at] === '"') {
      let i = at + 1;
      let inner = "";
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            inner += '"';
            i += 2;
            continue;
          }
          break;
        }
        inner += text[i];
        i++;
      }
      if (i < text.length && ends(i + 1)) {
        value = inner;
        wasQuoted = true;
        at = i + 1;
      }
    }
    if (!wasQuoted) {
      let i = at;
      while (!ends(i)) i++;
      value = text.slice(at, i);
      at = i;
    }
    row.push(value);
    marks.push(wasQuoted);
    if (at >= text.length) break;
    if (text[at] === sep) {
      at++;
      if (at === text.length) {
        row.push("");
        marks.push(false);
        break;
      }
      continue;
    }
    at += text[at] === "\r" ? 2 : 1;
    rows.push(row);
    quoted?.push(marks);
    row = [];
    marks = [];
  }
  rows.push(row);
  quoted?.push(marks);
  return rows;
}

/** CSV, when every line splits into the same number (two or more) of fields; else undefined. */
function csv(/** @type {string} */ body) {
  /** @type {boolean[][]} */
  const quoted = [];
  const rows = split(body, ",", quoted);
  const width = rows[0]?.length ?? 0;
  if (rows.length < 2 || width < 2 || rows.some((r) => r.length !== width)) return undefined;
  return rows.map((row, r) => row.map((v, c) => (v === "" && !quoted[r]?.[c] ? null : v)));
}

/**
 * The rows of values a paste holds.
 * @param {string} text
 * @param {{ ours?: boolean }} [options] `ours`: the text is what the plugin itself copied last,
 *   so its escapes are read (clipboard.js).
 * @returns {Pasted}
 */
export function readPaste(text, { ours = false } = {}) {
  const body = text.replace(/\r?\n$/u, "");
  const tab = body.includes("\t");
  if (!tab && !body.includes("\n")) {
    if (ours) return { rows: [[copyField(body)]], format: "value" };
    return { rows: [[body === "\\N" ? null : body]], format: "value" };
  }
  if (ours)
    return {
      rows: body.split(/\r?\n/u).map((line) => line.split("\t").map(copyField)),
      format: "copy",
    };
  const comma = tab ? undefined : csv(body);
  if (comma) return { rows: comma, format: "csv" };
  const rows = split(body, "\t").map((row) => row.map((v) => (v === "\\N" ? null : v)));
  return { rows, format: "tsv" };
}
