// Composes a page as DjVu does (DjVu v3 specification, 7.1.3): the background image scaled to the
// page, then every pixel of the JB2 mask painted with the foreground colour: the FG44 image's
// colour there, the FGbz palette colour of the shape that covers it, or black. Smaller outputs
// average the mask over each output pixel, so thumbnails of text stay readable.

/**
 * @typedef {{ width: number, height: number, rgba: Uint8Array }} Raster
 * @typedef {Raster & { red: number }} Layer  `red`: page pixels per layer pixel
 * @typedef {{ width: number, height: number, shapes: { width: number, height: number,
 *   bits: Uint8Array }[], blits: { shape: number, left: number, top: number }[] }} JB2Image
 * @typedef {{ colours: Uint8Array, indices: Uint16Array | null }} Palette
 */

/**
 * @param {{ width: number, height: number, outWidth: number, outHeight: number,
 *   mask?: JB2Image | null, background?: Layer | null, foreground?: Layer | null,
 *   palette?: Palette | null, pace?: import("./pace.js").Pacer }} page
 * @returns {Promise<Raster>}
 */
export async function compose(page) {
  const { width, height, outWidth, outHeight, mask, background, foreground, palette, pace } = page;
  const ink = mask ? await inkOf(mask, width, height, palette ?? null, pace) : null;
  const out = new Uint8Array(outWidth * outHeight * 4);
  const sx = width / outWidth;
  const sy = height / outHeight;
  const backdrop = background ? sampler(background, sx, sy, outWidth, outHeight) : null;
  const colours = palette?.colours;
  const ones = sx === 1 && sy === 1;
  const left = new Int32Array(outWidth + 1);
  for (let x = 0; x <= outWidth; x++) left[x] = Math.min(width, Math.round(x * sx));
  const row = new Uint8Array(outWidth * 3).fill(255);
  const rgb = new Int32Array(3);
  /** The ink colour at page pixel (x, y), whose ink value is `v`, into `rgb`. */
  const inkColour = (/** @type {number} */ v, /** @type {number} */ x, /** @type {number} */ y) => {
    if (colours) {
      const at = (v - 1) * 3;
      rgb[0] = colours[at] ?? 0;
      rgb[1] = colours[at + 1] ?? 0;
      rgb[2] = colours[at + 2] ?? 0;
    } else if (foreground) {
      const fx = Math.min(foreground.width - 1, Math.floor(x / foreground.red));
      const fy = Math.min(foreground.height - 1, Math.floor(y / foreground.red));
      const at = (fy * foreground.width + fx) * 4;
      rgb[0] = foreground.rgba[at];
      rgb[1] = foreground.rgba[at + 1];
      rgb[2] = foreground.rgba[at + 2];
    } else {
      rgb[0] = rgb[1] = rgb[2] = 0;
    }
  };
  for (let oy = 0; oy < outHeight; oy++) {
    if (pace?.due()) await pace.rest();
    if (backdrop) backdrop(oy, row);
    const top = Math.min(height, Math.round(oy * sy));
    const bottom = Math.max(top + 1, Math.min(height, Math.round((oy + 1) * sy)));
    for (let ox = 0, o = oy * outWidth * 4, r3 = 0; ox < outWidth; ox++, o += 4, r3 += 3) {
      let r = row[r3];
      let g = row[r3 + 1];
      let b = row[r3 + 2];
      if (ink && ones) {
        const v = ink[oy * width + ox];
        if (v) {
          inkColour(v, ox, oy);
          r = rgb[0];
          g = rgb[1];
          b = rgb[2];
        }
      } else if (ink) {
        const x0 = left[ox];
        const x1 = Math.max(x0 + 1, left[ox + 1]);
        let n = 0;
        let ir = 0;
        let ig = 0;
        let ib = 0;
        for (let y = top; y < bottom; y++) {
          for (let x = x0, at = y * width + x0; x < x1; x++, at++) {
            const v = ink[at];
            if (!v) continue;
            n++;
            inkColour(v, x, y);
            ir += rgb[0];
            ig += rgb[1];
            ib += rgb[2];
          }
        }
        if (n) {
          const area = (x1 - x0) * (bottom - top);
          const a = n / area;
          r = Math.round(r * (1 - a) + ir / area);
          g = Math.round(g * (1 - a) + ig / area);
          b = Math.round(b * (1 - a) + ib / area);
        }
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return { width: outWidth, height: outHeight, rgba: out };
}

/**
 * The mask at page size: 0 where it is white, else 1 (no palette) or 1 + the palette index of
 * the last shape painted there.
 * @param {JB2Image} image @param {number} width @param {number} height
 * @param {Palette | null} palette @param {import("./pace.js").Pacer} [pace]
 */
async function inkOf(image, width, height, palette, pace) {
  const ink = palette ? new Uint16Array(width * height) : new Uint8Array(width * height);
  const { blits, shapes } = image;
  const indices = palette?.indices;
  for (let i = 0; i < blits.length; i++) {
    if ((i & 63) === 0 && pace?.due()) await pace.rest();
    const blit = blits[i];
    const shape = shapes[blit.shape];
    if (!shape) continue;
    const value = palette ? 1 + (indices && i < indices.length ? indices[i] : 0) : 1;
    const x0 = Math.max(0, blit.left);
    const x1 = Math.min(width, blit.left + shape.width);
    const y0 = Math.max(0, blit.top);
    const y1 = Math.min(height, blit.top + shape.height);
    for (let y = y0; y < y1; y++) {
      const row = (y - blit.top) * shape.width - blit.left;
      for (let x = x0, at = y * width + x0; x < x1; x++, at++) {
        if (shape.bits[row + x]) ink[at] = value;
      }
    }
  }
  return ink;
}

/**
 * Bilinear sampling of a layer at the centres of output pixels, one output row at a time, with
 * weights in 1/256.
 * @param {Layer} layer @param {number} sx @param {number} sy page pixels per output pixel
 * @param {number} outWidth @param {number} outHeight
 */
function sampler(layer, sx, sy, outWidth, outHeight) {
  const { width, height, rgba, red } = layer;
  const axis = (/** @type {number} */ n, /** @type {number} */ s, /** @type {number} */ size) => {
    const lo = new Int32Array(n);
    const hi = new Int32Array(n);
    const w = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      // Page pixel p samples the layer at p / red, as DjVu viewers draw it (closer to them than
      // aligning pixel centres).
      const at = Math.max(0, Math.min(size - 1, ((i + 0.5) * s - 0.5) / red));
      const floor = Math.floor(at);
      lo[i] = floor;
      hi[i] = Math.min(size - 1, floor + 1);
      w[i] = Math.round((at - floor) * 256);
    }
    return { lo, hi, w };
  };
  const xs = axis(outWidth, sx, width);
  const ys = axis(outHeight, sy, height);
  return (/** @type {number} */ oy, /** @type {Uint8Array} */ row) => {
    const wy = ys.w[oy] ?? 0;
    const upper = (ys.lo[oy] ?? 0) * width;
    const lower = (ys.hi[oy] ?? 0) * width;
    for (let ox = 0, r = 0; ox < outWidth; ox++, r += 3) {
      const wx = xs.w[ox] ?? 0;
      const xl = xs.lo[ox] ?? 0;
      const xh = xs.hi[ox] ?? 0;
      const a = (upper + xl) * 4;
      const b = (upper + xh) * 4;
      const c = (lower + xl) * 4;
      const d = (lower + xh) * 4;
      for (let k = 0; k < 3; k++) {
        const t = (rgba[a + k] << 8) + (rgba[b + k] - rgba[a + k]) * wx;
        const u = (rgba[c + k] << 8) + (rgba[d + k] - rgba[c + k]) * wx;
        row[r + k] = ((t << 8) + (u - t) * wy + 32768) >> 16;
      }
    }
  };
}
