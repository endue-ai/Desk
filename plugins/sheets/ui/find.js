// Find in the sheet on screen: every cell whose displayed text holds the words, ignoring case, in
// reading order (row by row), over the rows and columns that show. No DOM.

/**
 * @typedef {import("./model.js").Sheet} Sheet
 * @typedef {import("./layout.js").Axis} Axis
 * @typedef {{ rows: Int32Array, cols: Int32Array, length: number, capped: boolean }} Matches
 */

/** More matches than this are not counted: "10000+ matches". */
export const MATCH_LIMIT = 10_000;

/**
 * @param {Sheet} sheet
 * @param {Axis} rows
 * @param {Axis} cols
 * @param {string} query
 * @returns {Matches}
 */
export function findAll(sheet, rows, cols, query) {
  const rowsOut = new Int32Array(MATCH_LIMIT);
  const colsOut = new Int32Array(MATCH_LIMIT);
  let length = 0;
  const words = query.toLocaleLowerCase();
  if (!words) return { rows: rowsOut, cols: colsOut, length, capped: false };
  const lastRow = rows.until(sheet.lastRow);
  const lastCol = cols.until(sheet.lastCol);
  for (let p = 0; p <= lastRow; p++) {
    const r = rows.index[p] ?? 0;
    for (let q = 0; q <= lastCol; q++) {
      const c = cols.index[q] ?? 0;
      if (!sheet.cell(r, c)) continue;
      if (!sheet.text(r, c).toLocaleLowerCase().includes(words)) continue;
      if (length === MATCH_LIMIT) return { rows: rowsOut, cols: colsOut, length, capped: true };
      rowsOut[length] = r;
      colsOut[length] = c;
      length++;
    }
  }
  return { rows: rowsOut, cols: colsOut, length, capped: false };
}

/**
 * The match after (or with `back`, before) a cell, wrapping around; -1 when there is none.
 * @param {Matches} matches
 * @param {number} r
 * @param {number} c
 * @param {boolean} [back]
 */
export function nextMatch(matches, r, c, back = false) {
  const { length } = matches;
  if (length === 0) return -1;
  const after = (/** @type {number} */ i) => {
    const mr = matches.rows[i] ?? 0;
    return mr > r || (mr === r && (matches.cols[i] ?? 0) > c);
  };
  // The first match after the cell, by binary search over reading order.
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (after(mid)) hi = mid;
    else lo = mid + 1;
  }
  if (!back) return lo % length;
  const at = lo - 1;
  const here = at >= 0 && matches.rows[at] === r && matches.cols[at] === c;
  const before = here ? at - 1 : at;
  return (before + length) % length;
}
