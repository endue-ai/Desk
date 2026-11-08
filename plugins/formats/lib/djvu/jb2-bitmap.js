// JB2 bitmaps (DjVu v3 specification, appendix 2, 11.5.9 and 11.5.10): direct coding with a
// 10-pixel template, and refinement coding against a library shape with an 11-pixel template.
// Rows are decoded top first; pixels outside the bitmap are white.

/** @typedef {{ width: number, height: number, bits: Uint8Array }} Bitmap  1 is black, row 0 on top */

/** Bytes read past the end of the data after which the stream counts as cut short. */
const MOST_PAST = 256;

/** @param {import("./zp.js").ZPDecoder} zp */
export function checkEnd(zp) {
  if (zp.past > MOST_PAST) throw new Error("The JB2 data is cut short or damaged.");
}

/**
 * A directly coded bitmap.
 * @param {import("./zp.js").ZPDecoder} zp @param {Uint8Array} contexts 1024 contexts
 * @param {number} width @param {number} height @param {import("./pace.js").Pacer} [pace]
 * @returns {Promise<Bitmap>}
 */
export async function decodeDirect(zp, contexts, width, height, pace) {
  // Two white rows above, two white columns left, three right: the template never leaves it.
  const stride = width + 5;
  const pad = new Uint8Array(stride * (height + 2) + 8);
  for (let y = 0; y < height; y++) {
    if (pace?.due()) await pace.rest();
    checkEnd(zp);
    const r0 = (y + 2) * stride + 2;
    const r1 = r0 - stride;
    const r2 = r1 - stride;
    let up2 = (pad[r2 - 1] << 2) | (pad[r2] << 1) | pad[r2 + 1];
    let up1 =
      (pad[r1 - 2] << 4) | (pad[r1 - 1] << 3) | (pad[r1] << 2) | (pad[r1 + 1] << 1) | pad[r1 + 2];
    let left = 0;
    for (let x = 0; x < width; x++) {
      const bit = zp.decode(contexts, (up2 << 7) | (up1 << 2) | left);
      pad[r0 + x] = bit;
      up2 = ((up2 << 1) & 7) | pad[r2 + x + 2];
      up1 = ((up1 << 1) & 31) | pad[r1 + x + 3];
      left = ((left << 1) & 3) | bit;
    }
  }
  return unpad(pad, stride, 2, 2, width, height);
}

/**
 * A bitmap coded by refinement of `reference`, the two aligned on their centres: the centre
 * column is the left one of two, the centre row the lower one of two.
 * @param {import("./zp.js").ZPDecoder} zp @param {Uint8Array} contexts 2048 contexts
 * @param {number} width @param {number} height @param {Bitmap} reference
 * @param {import("./pace.js").Pacer} [pace]
 * @returns {Promise<Bitmap>}
 */
export async function decodeRefined(zp, contexts, width, height, reference, pace) {
  const dx = ((reference.width - 1) >> 1) - ((width - 1) >> 1);
  const dy = (reference.height >> 1) - (height >> 1);
  // The reference as seen from the current bitmap, with a white margin of one pixel.
  const stride = width + 2;
  const ref = new Uint8Array(stride * (height + 2));
  for (let y = -1; y <= height; y++) {
    const ry = y + dy;
    if (ry < 0 || ry >= reference.height) continue;
    for (let x = -1; x <= width; x++) {
      const rx = x + dx;
      if (rx >= 0 && rx < reference.width) {
        ref[(y + 1) * stride + x + 1] = reference.bits[ry * reference.width + rx];
      }
    }
  }
  const cur = new Uint8Array(stride * (height + 1) + 2);
  for (let y = 0; y < height; y++) {
    if (pace?.due()) await pace.rest();
    checkEnd(zp);
    const c0 = (y + 1) * stride + 1;
    const c1 = c0 - stride;
    const m0 = (y + 1) * stride + 1;
    const m1 = m0 - stride;
    const m2 = m0 + stride;
    for (let x = 0; x < width; x++) {
      const context =
        (cur[c1 + x - 1] << 10) |
        (cur[c1 + x] << 9) |
        (cur[c1 + x + 1] << 8) |
        (cur[c0 + x - 1] << 7) |
        (ref[m1 + x] << 6) |
        (ref[m0 + x - 1] << 5) |
        (ref[m0 + x] << 4) |
        (ref[m0 + x + 1] << 3) |
        (ref[m2 + x - 1] << 2) |
        (ref[m2 + x] << 1) |
        ref[m2 + x + 1];
      cur[c0 + x] = zp.decode(contexts, context);
    }
  }
  return unpad(cur, stride, 1, 1, width, height);
}

/**
 * The bitmap inside a padded buffer.
 * @param {Uint8Array} pad @param {number} stride @param {number} top @param {number} left
 * @param {number} width @param {number} height
 */
function unpad(pad, stride, top, left, width, height) {
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const from = (y + top) * stride + left;
    bits.set(pad.subarray(from, from + width), y * width);
  }
  return { width, height, bits };
}

/**
 * The bitmap without its empty edge rows and columns, and how far its top-left corner moved.
 * @param {Bitmap} bitmap @returns {{ bitmap: Bitmap, left: number, top: number }}
 */
export function trim(bitmap) {
  const { width, height, bits } = bitmap;
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (bits[row + x]) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first < 0) continue;
    if (y < top) top = y;
    bottom = y;
    if (first < left) left = first;
    if (last > right) right = last;
  }
  if (bottom < 0)
    return { bitmap: { width: 0, height: 0, bits: new Uint8Array(0) }, left: 0, top: 0 };
  if (top === 0 && left === 0 && bottom === height - 1 && right === width - 1) {
    return { bitmap, left: 0, top: 0 };
  }
  const w = right - left + 1;
  const h = bottom - top + 1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const from = (y + top) * width + left;
    out.set(bits.subarray(from, from + w), y * w);
  }
  return { bitmap: { width: w, height: h, bits: out }, left, top };
}
