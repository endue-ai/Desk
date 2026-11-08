// The grid's two axes: which rows or columns show (hidden ones are left out), where each starts in
// pixels, and back from a pixel to a row or column. Prefix sums in typed arrays and binary search:
// 100 000 rows cost about a megabyte and any lookup about seventeen steps.

/**
 * @typedef {{
 *   count: number, index: Int32Array, offset: Float64Array, total: number,
 *   at(px: number): number, position(i: number): number,
 *   from(i: number): number, until(i: number): number,
 * }} Axis
 */

/**
 * One axis. Positions count only what shows; `index[p]` is the row or column at position p and
 * `offset[p]` where it starts.
 * @param {number} length rows or columns in the sheet
 * @param {(i: number) => number} size in pixels
 * @param {(i: number) => boolean} hidden
 * @param {number} [zoom]
 * @returns {Axis}
 */
export function axis(length, size, hidden, zoom = 1) {
  let count = 0;
  for (let i = 0; i < length; i++) if (!hidden(i)) count++;
  const index = new Int32Array(count);
  const offset = new Float64Array(count + 1);
  for (let i = 0, p = 0; i < length; i++) {
    if (hidden(i)) continue;
    index[p] = i;
    offset[p + 1] = (offset[p] ?? 0) + Math.max(0, Math.round(size(i) * zoom));
    p++;
  }
  return axisFrom(index, offset);
}

/** Attach constant-time metadata and binary lookups to axes prepared by the worker.
 * @param {Int32Array} index @param {Float64Array} offset @returns {Axis}
 */
export function axisFrom(index, offset) {
  const count = index.length;
  /** The first position whose index is at least i (count when none). */
  const from = (/** @type {number} */ i) => {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((index[mid] ?? 0) < i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return {
    count,
    index,
    offset,
    total: offset[count] ?? 0,
    /** The position under a pixel, clamped to the axis. */
    at(px) {
      let lo = 0;
      let hi = count - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((offset[mid] ?? 0) <= px) lo = mid;
        else hi = mid - 1;
      }
      return Math.max(0, lo);
    },
    /** The position of row or column i, or -1 when it is hidden. */
    position(i) {
      const p = from(i);
      return index[p] === i ? p : -1;
    },
    from,
    /** The last position whose index is at most i (-1 when none). */
    until: (i) => from(i + 1) - 1,
  };
}
