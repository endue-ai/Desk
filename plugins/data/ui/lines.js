// Lines and columns: where each line starts, built once per text, and an offset's 1-based line and
// column by binary search. Columns count UTF-16 code units, as the editor and the raw view do.

/**
 * Where each line of `text` starts.
 * @param {string} text
 * @returns {Uint32Array}
 */
export function lineStarts(text) {
  /** @type {number[]} */
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return Uint32Array.from(starts);
}

/**
 * The 1-based line and column of `offset`.
 * @param {ArrayLike<number>} starts
 * @param {number} offset
 */
export function positionOf(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, col: offset - (starts[low] ?? 0) + 1 };
}

/**
 * A position in a text: line, column, and a parse error at it.
 * @param {ArrayLike<number>} starts
 * @param {number} offset
 * @param {string} message
 */
export const errorAt = (starts, offset, message) => ({ message, ...positionOf(starts, offset) });
