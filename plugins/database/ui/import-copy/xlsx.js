import { t as messageText } from "../strings/index.js";

// An `.xlsx` file's first sheet as rows of text (PG-60), read with the vendored spreadsheet reader
// (ui/vendor/sheetjs, the copy of ADR 0043's, which the caller passes: the worker loads it, so the
// frame's main thread never does). A number is its digits, a date or time cell (a number with a
// date format) its ISO text, a boolean `true` or `false`, an error or an empty cell NULL; rows past
// the last cell with a value are left out. Pure.

/**
 * @typedef {import("./csv.js").Row} Row
 * @typedef {{ t?: string, v?: unknown, z?: string }} Cell
 * @typedef {{
 *   read(data: Uint8Array, options: Record<string, unknown>): { SheetNames: string[], Sheets: Record<string, Record<string, unknown>> },
 *   utils: { decode_range(ref: string): { s: { r: number, c: number }, e: { r: number, c: number } }, encode_cell(at: { r: number, c: number }): string },
 *   SSF: { is_date(format: string): boolean, parse_date_code(v: number): { y: number, m: number, d: number, H: number, M: number, S: number } },
 * }} Sheetjs
 */

const two = (/** @type {number} */ n) => String(n).padStart(2, "0");

/** A date cell's serial number as ISO text: the date alone at midnight. */
function dateText(/** @type {Sheetjs} */ X, /** @type {number} */ serial) {
  const { y, m, d, H, M, S } = X.SSF.parse_date_code(serial);
  const date = `${String(y).padStart(4, "0")}-${two(m)}-${two(d)}`;
  const time = `${two(H)}:${two(M)}:${two(S)}`;
  if (serial < 1) return time;
  return H === 0 && M === 0 && S === 0 ? date : `${date} ${time}`;
}

/** One cell as text, or NULL. */
function cellText(/** @type {Sheetjs} */ X, /** @type {Cell | undefined} */ cell) {
  if (!cell || cell.v === undefined || cell.v === null || cell.t === "e" || cell.t === "z")
    return null;
  if (cell.t === "b") return cell.v ? "true" : "false";
  if (cell.t === "n" && typeof cell.v === "number")
    return cell.z && X.SSF.is_date(cell.z) ? dateText(X, cell.v) : String(cell.v);
  if (cell.t === "d" && cell.v instanceof Date) return cell.v.toISOString();
  return String(cell.v);
}

/**
 * The first sheet's rows.
 * @param {Sheetjs} X
 * @param {Uint8Array} bytes
 * @returns {Row[]}
 */
export function xlsxRows(X, bytes) {
  // A workbook is a ZIP; the reader would take any other bytes as text.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new Error(messageText("importCopy.xlsx.theFileIsNotAWorkbook"));
  let book;
  try {
    book = X.read(bytes, {
      type: "array",
      cellNF: true,
      cellFormula: false,
      cellHTML: false,
      cellText: false,
    });
  } catch (error) {
    throw new Error(
      messageText("importCopy.xlsx.theFileIsNotAWorkbook2", {
        value: String(error instanceof Error ? error.message : error),
      }),
    );
  }
  const name = book.SheetNames[0];
  const sheet = name === undefined ? undefined : book.Sheets[name];
  const ref = /** @type {string | undefined} */ (sheet?.["!ref"]);
  if (!sheet || !ref) return [];
  const { s, e } = X.utils.decode_range(ref);
  /** @type {Row[]} */
  const rows = [];
  for (let r = s.r; r <= e.r; r++) {
    /** @type {Row} */
    const row = [];
    let filled = false;
    for (let c = s.c; c <= e.c; c++) {
      const value = cellText(
        X,
        /** @type {Cell | undefined} */ (sheet[X.utils.encode_cell({ r, c })]),
      );
      if (value !== null) filled = true;
      row.push(value);
    }
    if (filled) rows.push(row);
  }
  return rows;
}
