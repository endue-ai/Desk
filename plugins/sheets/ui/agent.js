// What an agent reads through Sheets (ADR 0088): a range of a sheet of the workbook on screen, or of
// another one Sheets has open, as the text each cell shows (and its formula, when asked), with the
// sheets and how far each is filled. It leaves the screen as it is. Sheets opens a file only through
// the desk (desk.files.open), so an agent opens one there first.
import { addressOf, columnName } from "./model.js";

/**
 * @typedef {{ buffer: string, path: string, name: string, book: import("./book.js").Book,
 *   modified?: boolean }} Open
 * @typedef {{ r0: number, c0: number, r1: number, c1: number }} Range
 */

/** The most rows and columns one read answers, and the range it reads without one. */
export const MOST = { rows: 500, cols: 50 };
const USUAL = { rows: 50, cols: 26 };

/** A column's index from its letters: A is 0, Z 25, AA 26. */
const columnOf = (/** @type {string} */ letters) =>
  [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/**
 * A1 or A1:D20 as rows and columns from 0, the end included; a bare A1 is one cell.
 * @returns {Range}
 */
export function rangeOf(/** @type {string} */ text) {
  const m = /^\s*([A-Za-z]{1,3})(\d{1,7})(?::([A-Za-z]{1,3})(\d{1,7}))?\s*$/.exec(text);
  if (!m) throw new Error(`${text} is not a range: say A1 or A1:D20.`);
  const [r0, c0] = [Number(m[2]) - 1, columnOf(m[1] ?? "A")];
  const [r1, c1] = m[3] ? [Number(m[4]) - 1, columnOf(m[3])] : [r0, c0];
  if (r0 < 0 || r1 < 0) throw new Error(`${text}: rows start at 1.`);
  return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
}

/** @param {import("./grid.js").Place | undefined} place */
function selected(place) {
  if (!place) return {};
  const { active, end } = place;
  const first = addressOf(Math.min(active.r, end.r), Math.min(active.c, end.c));
  const last = addressOf(Math.max(active.r, end.r), Math.max(active.c, end.c));
  return {
    activeCell: addressOf(active.r, active.c),
    selection: first === last ? first : `${first}:${last}`,
  };
}

/**
 * @param {{ on(name: string, handler: (args: unknown) => unknown): unknown }} commands
 * @param {{ open(): Open[], shown(): string | null, view: import("./sheets.js").View,
 *   edit(span: Range, values: string[][]): boolean }} deps
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
    const where = deps.view.where?.(file.buffer);
    const index =
      typeof a.sheet === "string"
        ? book.sheets.findIndex((s) => s.name === a.sheet)
        : (where?.sheet ?? 0);
    const named = book.sheets[index];
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
      ...selected(where?.places.find(([sheet]) => sheet === index)?.[1]),
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

  const current = () => {
    const file = deps.open().find((f) => f.buffer === deps.shown());
    if (file?.book.kind !== "sheets") throw new Error("No worksheet is open in Sheets.");
    return { file, book: file.book, where: deps.view.where?.(file.buffer) };
  };
  commands.on("endue.sheets.select", (raw) => {
    const { file, book, where } = current();
    const { sheet, range } = /** @type {{ sheet?: string, range: string }} */ (raw);
    const index =
      sheet === undefined ? (where?.sheet ?? 0) : book.sheets.findIndex((s) => s.name === sheet);
    const listed = book.sheets[index];
    if (!listed) throw new Error("That worksheet is not in the open file.");
    const span = rangeOf(range);
    if (
      span.r1 >= listed.rows ||
      span.c1 >= listed.cols ||
      listed.hiddenRow?.(span.r0) ||
      listed.hiddenRow?.(span.r1) ||
      listed.hiddenCol?.(span.c0) ||
      listed.hiddenCol?.(span.c1)
    )
      throw new Error("The range is outside the visible worksheet.");
    if (!deps.view.select) throw new Error("The worksheet grid is not visible.");
    deps.view.select(index, span);
    return {
      sheet: listed.name,
      ...selected(deps.view.where?.(file.buffer)?.places.find(([sheet]) => sheet === index)?.[1]),
    };
  });
  commands.on("endue.sheets.find", (raw) => {
    const { book, where } = current();
    const text = /** @type {{ text: string }} */ (raw).text.trim();
    if (!text) throw new Error("Give the worksheet text to find.");
    if (!deps.view.find) throw new Error("The worksheet grid is not visible.");
    return { sheet: book.sheets[where?.sheet ?? 0]?.name, cell: deps.view.find(text) ?? null };
  });
  commands.on("endue.sheets.edit", (raw) => {
    const { file, book, where } = current();
    const { range, values } = /** @type {{ range: string, values: string[][] }} */ (raw);
    const span = rangeOf(range);
    const rows = span.r1 - span.r0 + 1;
    const cols = span.c1 - span.c0 + 1;
    if (
      rows > MOST.rows ||
      cols > MOST.cols ||
      !Array.isArray(values) ||
      values.length !== rows ||
      values.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== cols ||
          row.some((value) => typeof value !== "string"),
      )
    )
      throw new Error("Values must fill the exact rectangular range.");
    return {
      path: file.path,
      sheet: book.sheets[where?.sheet ?? 0]?.name,
      range,
      unsaved: deps.edit(span, values),
    };
  });
}
