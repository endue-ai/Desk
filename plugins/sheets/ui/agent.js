// What an agent reads through Sheets (ADR 0088): a range of a sheet of the workbook on screen, or of
// another one Sheets has open, as the text each cell shows (and its formula, when asked), with the
// sheets and how far each is filled. It leaves the screen as it is. Sheets opens a file only through
// the desk (desk.files.open), so an agent opens one there first.
import { columnName } from "./model.js";

/**
 * @typedef {{ buffer: string, path: string, name: string, book: import("./book.js").Book,
 *   modified?: boolean }} Open
 */

/** The most rows and columns one read answers, and the range it reads without one. */
export const MOST = { rows: 500, cols: 50 };
const USUAL = { rows: 50, cols: 26 };

/** A column's index from its letters: A is 0, Z 25, AA 26. */
const columnOf = (/** @type {string} */ letters) =>
  [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/**
 * A1 or A1:D20 as rows and columns from 0, the end included; a bare A1 is one cell.
 * @returns {{ r0: number, c0: number, r1: number, c1: number }}
 */
export function rangeOf(/** @type {string} */ text) {
  const m = /^\s*([A-Za-z]{1,3})(\d{1,7})(?::([A-Za-z]{1,3})(\d{1,7}))?\s*$/.exec(text);
  if (!m) throw new Error(`${text} is not a range: say A1 or A1:D20.`);
  const [r0, c0] = [Number(m[2]) - 1, columnOf(m[1] ?? "A")];
  const [r1, c1] = m[3] ? [Number(m[4]) - 1, columnOf(m[3])] : [r0, c0];
  if (r0 < 0 || r1 < 0) throw new Error(`${text}: rows start at 1.`);
  return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
}

/**
 * @param {{ on(name: string, handler: (args: unknown) => unknown): unknown }} commands
 * @param {{ open(): Open[], shown(): string | null }} deps
 */
export function answerAgents(commands, deps) {
  commands.on("endue.sheets.read", (raw) => {
    const a = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
    const open = deps.open();
    const files = open.map((f) => ({
      path: f.path,
      name: f.name,
      onScreen: f.buffer === deps.shown(),
    }));
    const asked = typeof a.path === "string" && a.path !== "" ? a.path : undefined;
    const file = asked
      ? open.find((f) => f.path === asked || f.name === asked)
      : open.find((f) => f.buffer === deps.shown());
    if (!file) {
      if (asked)
        throw new Error(`Sheets has no ${asked} open; open it with desk.files.open first.`);
      throw new Error("No spreadsheet is open in Sheets; open one with desk.files.open first.");
    }
    const { book } = file;
    if (book.kind !== "sheets")
      return {
        path: file.path,
        files,
        values: null,
        reason: book.kind === "details" ? book.reason : book.url,
      };
    const sheets = book.sheets.map((s) => ({
      name: s.name,
      rows: s.lastRow + 1,
      cols: s.lastCol + 1,
    }));
    const named =
      typeof a.sheet === "string" ? book.sheets.find((s) => s.name === a.sheet) : book.sheets[0];
    if (!named) throw new Error(`${String(a.sheet)} is not a sheet of ${file.name}.`);
    const last = { r: named.lastRow, c: named.lastCol };
    const span =
      typeof a.range === "string"
        ? rangeOf(a.range)
        : {
            r0: 0,
            c0: 0,
            r1: Math.min(last.r, USUAL.rows - 1),
            c1: Math.min(last.c, USUAL.cols - 1),
          };
    const r1 = Math.min(span.r1, span.r0 + MOST.rows - 1, last.r);
    const c1 = Math.min(span.c1, span.c0 + MOST.cols - 1, last.c);
    /** @type {string[][]} */
    const values = [];
    /** @type {Record<string, string>} */
    const formulas = {};
    for (let r = span.r0; r <= r1; r++) {
      /** @type {string[]} */
      const row = [];
      for (let c = span.c0; c <= c1; c++) {
        row.push(named.text(r, c));
        const input = named.input(r, c);
        if (a.formulas === true && input.startsWith("="))
          formulas[`${columnName(c)}${r + 1}`] = input;
      }
      values.push(row);
    }
    const shownRange =
      values.length && c1 >= span.c0
        ? `${columnName(span.c0)}${span.r0 + 1}:${columnName(c1)}${r1 + 1}`
        : null;
    return {
      path: file.path,
      files,
      sheets,
      sheet: named.name,
      range: shownRange,
      values,
      ...(a.formulas === true ? { formulas } : {}),
      // Cut by the most one read answers, or past the default range while the sheet goes on.
      more:
        r1 < Math.min(span.r1, last.r) ||
        c1 < Math.min(span.c1, last.c) ||
        (typeof a.range !== "string" && (last.r > r1 || last.c > c1)),
      unsaved: file.modified === true,
    };
  });
}
