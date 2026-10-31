// What every own decoder returns, and the checks they share.
import { fail } from "../bytes.js";

/**
 * @typedef {{ label: string, value: string }} Row
 * @typedef {{ count: number, index: number, at(index: number): Uint8ClampedArray }} Slices
 * @typedef {{ width: number, height: number, rgba: Uint8ClampedArray, float?: Float32Array,
 *   depth?: string, rows?: Row[], slices?: Slices }} Pixels
 * @typedef {{ web: { mime: string, data: Uint8Array, width?: number, height?: number, label?: string },
 *   depth?: string, rows?: Row[] }} Web
 */

/** The most pixels a canvas is asked to hold. */
export const MAX_PIXELS = 2 ** 27;

/** An RGBA buffer for an image of this size, after checking the size is one to show. */
export function canvasFor(/** @type {number} */ width, /** @type {number} */ height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    fail("Its header gives no pixel size.");
  if (width * height > MAX_PIXELS) fail(`It is too large to show (${width} × ${height} pixels).`);
  return new Uint8ClampedArray(width * height * 4);
}

/** Fail when `need` bytes from `at` run past the end. */
export function enough(
  /** @type {Uint8Array} */ bytes,
  /** @type {number} */ at,
  /** @type {number} */ need,
) {
  if (at + need > bytes.length) fail("The file ends before its pixels do.");
}

/**
 * Greys to RGBA, stretched from [lo, hi] to [0, 255]; NaN (and `blank`) become transparent.
 * @param {ArrayLike<number>} values
 * @param {number} lo
 * @param {number} hi
 * @param {Uint8ClampedArray} out
 * @param {(i: number) => number} [order] the source index of output pixel i
 */
export function stretch(values, lo, hi, out, order = (i) => i) {
  const span = hi > lo ? 255 / (hi - lo) : 0;
  for (let i = 0; i < out.length / 4; i++) {
    const v = values[order(i)] ?? Number.NaN;
    const p = i * 4;
    if (Number.isNaN(v)) {
      out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
      continue;
    }
    const g = span ? (v - lo) * span : hi > lo ? 0 : 128;
    out[p] = out[p + 1] = out[p + 2] = g;
    out[p + 3] = 255;
  }
  return out;
}

/** The smallest and largest finite values. */
export function range(/** @type {ArrayLike<number>} */ values) {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? Number.NaN;
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : [0, 0];
}
