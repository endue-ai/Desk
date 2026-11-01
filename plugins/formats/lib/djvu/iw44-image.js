// IW44 reconstruction (DjVu v3 specification, appendix 1, image reconstruction): coefficients into
// the image array, the inverse (4,4) Dubuc-Deslauriers-Lemire lifting transform, precision
// reduction to 8 bits and YCbCr to RGB. A reduced image stops the transform at a coarser scale.

// Table 3: the step-size entry of each coefficient index.
export const STEP_INDEX = new Uint8Array(1024);
// A coefficient index's bits b9..b0 give its row b1b3b5b7b9 and column b0b2b4b6b8 in the block.
const ROW = new Uint8Array(1024);
const COLUMN = new Uint8Array(1024);
for (let i = 0; i < 1024; i++) {
  if (i < 4) STEP_INDEX[i] = i;
  else if (i < 16) STEP_INDEX[i] = 4 + ((i - 4) >> 2);
  else if (i < 64) STEP_INDEX[i] = 7 + ((i - 16) >> 4);
  else if (i < 256) STEP_INDEX[i] = 10 + ((i - 64) >> 6);
  else STEP_INDEX[i] = 13 + ((i - 256) >> 8);
  let row = 0;
  let column = 0;
  for (let bit = 0; bit < 5; bit++) {
    column |= ((i >> (2 * bit)) & 1) << (4 - bit);
    row |= ((i >> (2 * bit + 1)) & 1) << (4 - bit);
  }
  ROW[i] = row;
  COLUMN[i] = column;
}

/**
 * The layer's pixels reduced by `subsample`: ceil(width / s) x ceil(height / s), RGBA.
 * @param {import("./iw44.js").IW44Image} image @param {number} subsample
 * @param {import("./pace.js").Pacer} [pace]
 */
export async function reconstruct(image, subsample, pace) {
  const width = Math.ceil(image.width / subsample);
  const height = Math.ceil(image.height / subsample);
  /** @type {Int32Array[]} */
  const planes = [];
  for (let c = 0; c < image.coefficients.length; c++) {
    const plane = place(image, c, subsample, width, height);
    await transform(plane, width, height, 16 / subsample, pace);
    planes.push(plane);
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    // Plane rows count up from the bottom; output rows go down from the top.
    const from = (height - 1 - y) * width;
    let to = y * width * 4;
    if (planes.length === 1) {
      const p = planes[0];
      for (let x = 0; x < width; x++, to += 4) {
        const v = 127 - reduce(p[from + x]);
        rgba[to] = v;
        rgba[to + 1] = v;
        rgba[to + 2] = v;
        rgba[to + 3] = 255;
      }
    } else {
      const [py, pb, pr] = planes;
      for (let x = 0; x < width; x++, to += 4) {
        const luma = reduce(py[from + x]) + 128;
        const cb = reduce(pb[from + x]);
        const cr = reduce(pr[from + x]);
        // 7.7.7's matrix, rounded as the reference decoder rounds it.
        rgba[to] = clamp(luma + cr + (cr >> 1));
        rgba[to + 1] = clamp(luma - (cb >> 2) - ((3 * cr) >> 2));
        rgba[to + 2] = clamp(luma + 2 * cb - (cb >> 2));
        rgba[to + 3] = 255;
      }
    }
    if ((y & 63) === 63 && pace?.due()) await pace.rest();
  }
  return { width, height, rgba };
}

/** A fixed-point value with 6 fractional bits, rounded and clamped to -128..127. @param {number} v */
function reduce(v) {
  const n = (v + 32) >> 6;
  return Math.max(-128, Math.min(127, n));
}

/** @param {number} v */
const clamp = (v) => Math.max(0, Math.min(255, v));

/**
 * One component's coefficients on the lattice the reduced image keeps (every s-th row and
 * column), rows from the bottom. A coefficient activated but not yet refined holds 3/2 of its
 * activation step (3 of its current step); it is shown at 11/8 of it, as the reference decoder
 * shows it, while refined ones sit at the centre of their interval.
 * @param {import("./iw44.js").IW44Image} image @param {number} component @param {number} s
 * @param {number} width @param {number} height
 */
function place(image, component, s, width, height) {
  const plane = new Int32Array(width * height);
  const coef = image.coefficients[component];
  const steps = image.steps[component];
  /** @type {number[]} */
  const kept = [];
  for (let i = 0; i < 1024; i++) if (ROW[i] % s === 0 && COLUMN[i] % s === 0) kept.push(i);
  for (let by = 0; by < image.blocksHigh; by++) {
    for (let bx = 0; bx < image.blocksWide; bx++) {
      const base = (by * image.blocksWide + bx) * 1024;
      for (const i of kept) {
        let v = coef[base + i];
        if (v === 0) continue;
        const x = (bx * 32 + COLUMN[i]) / s;
        const y = (by * 32 + ROW[i]) / s;
        if (x >= width || y >= height) continue;
        const step = steps[STEP_INDEX[i]];
        if (step > 0 && (v === 3 * step || v === -3 * step)) v -= v > 0 ? step >> 2 : -(step >> 2);
        plane[y * width + x] = v;
      }
    }
  }
  return plane;
}

/**
 * The inverse wavelet transform from scale `top` down to 1 on the plane: at each scale the
 * columns, then the rows.
 * @param {Int32Array} d @param {number} width @param {number} height @param {number} top
 * @param {import("./pace.js").Pacer} [pace]
 */
async function transform(d, width, height, top, pace) {
  for (let s = top; s >= 1; s >>= 1) {
    const rows = Math.floor((height - 1) / s) + 1;
    const stride = s * width;
    for (let x = 0; x < width; x += s) {
      lift(d, x, stride, rows);
      if ((x & 63) === 0 && pace?.due()) await pace.rest();
    }
    const columns = Math.floor((width - 1) / s) + 1;
    for (let y = 0; y < height; y += s) {
      lift(d, y * width, s, columns);
      if ((y & 63) === 0 && pace?.due()) await pace.rest();
    }
  }
}

/**
 * One column or row of n samples at `start`, `step` apart: the lifting pass on the even samples,
 * then the prediction pass on the odd ones (7.7.4). Samples outside the line count as 0.
 * @param {Int32Array} d @param {number} start @param {number} step @param {number} n
 */
function lift(d, start, step, n) {
  if (n < 2) return;
  const end = start + (n - 1) * step;
  for (let i = start; i <= end; i += 2 * step) {
    const a = i - step >= start ? d[i - step] : 0;
    const b = i + step <= end ? d[i + step] : 0;
    const c = i - 3 * step >= start ? d[i - 3 * step] : 0;
    const e = i + 3 * step <= end ? d[i + 3 * step] : 0;
    d[i] -= (9 * (a + b) - (c + e) + 16) >> 5;
  }
  for (let k = 1, i = start + step; k < n; k += 2, i += 2 * step) {
    if (k >= 3 && k + 3 < n) {
      d[i] += (9 * (d[i - step] + d[i + step]) - (d[i - 3 * step] + d[i + 3 * step]) + 8) >> 4;
    } else if (k + 1 < n) d[i] += (d[i - step] + d[i + step] + 1) >> 1;
    else d[i] += d[i - step];
  }
}
