// The sheet the grid draws, whatever format it came from: cells by row and column, the text each
// one shows and the content the formula bar shows, merges, sizes, hidden rows and columns, frozen
// panes and styles. No DOM; cells are read on demand, so a sheet costs what its source costs.

/**
 * @typedef {{ t: string, v?: unknown, w?: string, f?: string, z?: unknown }} Cell
 * @typedef {{ r: number, c: number }} Address
 * @typedef {{ s: Address, e: Address }} Range
 * @typedef {{
 *   bold?: true, italic?: true, underline?: true, strike?: true, color?: string, fill?: string,
 *   align?: string, wrap?: true,
 * }} CellStyle
 * @typedef {{ rows: number, cols: number }} Frozen
 * @typedef {{
 *   name: string, rows: number, cols: number, lastRow: number, lastCol: number,
 *   axes?: { rows: import("./layout.js").Axis, cols: import("./layout.js").Axis },
 *   cell(r: number, c: number): Cell | undefined, filled(r: number, c: number): boolean,
 *   text(r: number, c: number): string, input(r: number, c: number): string,
 *   style(r: number, c: number): CellStyle | undefined, merges: Range[],
 *   releaseRow?(r: number): void,
 *   width(c: number): number, height(r: number): number,
 *   hiddenRow(r: number): boolean, hiddenCol(c: number): boolean, frozen: Frozen,
 * }} Sheet
 * @typedef {{
 *   name: string, rows: number, cols: number,
 *   cellAt(r: number, c: number): Cell | undefined,
 *   lastRow?: number, lastCol?: number, merges?: Range[],
 *   widths?: ArrayLike<number | undefined>, heights?: ArrayLike<number | undefined>,
 *   hiddenRows?: Set<number>, hiddenCols?: Set<number>, frozen?: Frozen,
 *   styleAt?: (r: number, c: number) => CellStyle | undefined,
 *   releaseRow?: (r: number) => void,
 *   format?: (cell: Cell) => string | undefined,
 * }} SheetSource
 */

/** Excel's default column (8.43 characters of Calibri 11) and row (15 points), in pixels. */
export const DEFAULT_WIDTH = 64;
export const DEFAULT_HEIGHT = 20;
/** A small sheet still shows a page of empty cells around its data, as spreadsheet programs do. */
const MIN_ROWS = 100;
const MIN_COLS = 26;

/** The column letters for a column index: 0 is A, 26 is AA. */
export function columnName(/** @type {number} */ c) {
  let name = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** A1-style address. */
export const addressOf = (/** @type {number} */ r, /** @type {number} */ c) =>
  `${columnName(c)}${r + 1}`;

/** Whether a number format shows a date or a time: d, m, y, h or s outside quotes and brackets. */
export function isDateFormat(/** @type {unknown} */ format) {
  if (typeof format !== "string" || format === "General") return false;
  const bare = format.replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./gu, "");
  return /[dmyhs]/iu.test(bare);
}

const isPercentFormat = (/** @type {unknown} */ format) =>
  typeof format === "string" && format.replace(/"[^"]*"|\\./gu, "").includes("%");

/** A number as the formula bar shows it: at most 15 significant digits, no exponent below 1e21. */
export const plainNumber = (/** @type {number} */ n) =>
  Number.isFinite(n) ? String(Number(n.toPrecision(15))) : String(n);

/** The text a cell shows when the file gave none: General format. */
function generalText(/** @type {Cell} */ cell) {
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  if (cell.t === "n" && typeof cell.v === "number") {
    const n = cell.v;
    return Math.abs(n) >= 1e11 || (n !== 0 && Math.abs(n) < 1e-9)
      ? n.toExponential(5).replace("e+", "E+").replace("e-", "E-")
      : String(Number(n.toPrecision(11)));
  }
  if (cell.t === "z" || cell.v == null) return "";
  return String(cell.v);
}

/**
 * @param {SheetSource} source
 * @returns {Sheet}
 */
export function createSheet(source) {
  const { name, cellAt, merges = [], frozen = { rows: 0, cols: 0 } } = source;
  const { widths = [], heights = [], hiddenRows = new Set(), hiddenCols = new Set() } = source;
  const sorted = [...merges].sort((a, b) => a.s.r - b.s.r || a.s.c - b.s.c);
  const lastRow = source.lastRow ?? source.rows - 1;
  const lastCol = source.lastCol ?? source.cols - 1;
  const mergedRows = sorted.reduce((n, m) => Math.max(n, m.e.r + 1), 0);
  const mergedCols = sorted.reduce((n, m) => Math.max(n, m.e.c + 1), 0);

  /** @param {number} r @param {number} c */
  const text = (r, c) => {
    const cell = cellAt(r, c);
    if (!cell) return "";
    if (typeof cell.w === "string") return cell.w;
    return source.format?.(cell) ?? generalText(cell);
  };

  return {
    name,
    rows: Math.max(source.rows, mergedRows, frozen.rows, MIN_ROWS),
    cols: Math.max(source.cols, mergedCols, frozen.cols, MIN_COLS),
    lastRow: Math.max(lastRow, mergedRows - 1),
    lastCol: Math.max(lastCol, mergedCols - 1),
    cell: cellAt,
    releaseRow: source.releaseRow,
    filled: (r, c) => {
      const cell = cellAt(r, c);
      return cell !== undefined && cell.t !== "z" && cell.v !== undefined && cell.v !== "";
    },
    text,
    input: (r, c) => {
      const cell = cellAt(r, c);
      if (!cell) return "";
      if (cell.f) return `=${cell.f}`;
      if (cell.t === "n" && typeof cell.v === "number") {
        if (isDateFormat(cell.z)) return text(r, c);
        // OpenDocument cells carry the shown text but not always the format.
        const percent =
          cell.z === undefined ? /%\s*$/u.test(cell.w ?? "") : isPercentFormat(cell.z);
        if (percent) return `${plainNumber(cell.v * 100)}%`;
        return plainNumber(cell.v);
      }
      if (cell.t === "s" && typeof cell.v === "string") return cell.v;
      return text(r, c);
    },
    style: (r, c) => source.styleAt?.(r, c),
    merges: sorted,
    width: (c) => widths[c] ?? DEFAULT_WIDTH,
    height: (r) => heights[r] ?? DEFAULT_HEIGHT,
    hiddenRow: (r) => hiddenRows.has(r),
    hiddenCol: (c) => hiddenCols.has(c),
    frozen,
  };
}
