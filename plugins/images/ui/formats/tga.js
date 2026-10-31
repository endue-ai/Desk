// Truevision TGA: true colour, greyscale and colour-mapped, raw or RLE, 8, 15, 16, 24 and 32 bits,
// in any of the four corner orders.
import { fail, reader } from "../bytes.js";
import { canvasFor, enough } from "./pixels.js";

const five = (/** @type {number} */ c) => (c << 3) | (c >> 2);

/** @returns {import("./pixels.js").Pixels} */
export function decodeTga(/** @type {Uint8Array} */ bytes) {
  const r = reader(bytes);
  const idLength = r.u8(0);
  const mapType = r.u8(1);
  const type = r.u8(2);
  const [mapFirst, mapLength, mapBits] = [r.u16(3), r.u16(5), r.u8(7)];
  const [width, height, bits, descriptor] = [r.u16(12), r.u16(14), r.u8(16), r.u8(17)];
  const base = type & 7;
  const rle = (type & 8) !== 0;
  if (![1, 2, 3].includes(base) || type > 11)
    fail("It uses a TGA image type Images does not read.");
  const alphaBits = descriptor & 15;
  const grey = base === 3;
  const out = canvasFor(width, height);

  /** Write the colour of `size` bits at `at` into `to` at `o`. */
  const colour = (
    /** @type {Uint8Array | Uint8ClampedArray} */ to,
    /** @type {number} */ o,
    /** @type {number} */ at,
    /** @type {number} */ size,
    /** @type {boolean} */ isGrey,
  ) => {
    if (isGrey) {
      const v = bytes[at] ?? 0;
      to[o] = to[o + 1] = to[o + 2] = v;
      to[o + 3] = size === 16 ? (bytes[at + 1] ?? 0) : 255;
    } else if (size === 15 || size === 16) {
      const v = (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
      to[o] = five((v >> 10) & 31);
      to[o + 1] = five((v >> 5) & 31);
      to[o + 2] = five(v & 31);
      to[o + 3] = size === 16 && alphaBits ? (v & 0x8000 ? 255 : 0) : 255;
    } else if (size === 24 || size === 32) {
      to[o] = bytes[at + 2] ?? 0;
      to[o + 1] = bytes[at + 1] ?? 0;
      to[o + 2] = bytes[at] ?? 0;
      to[o + 3] = size === 32 ? (bytes[at + 3] ?? 0) : 255;
    } else fail(`It stores ${size}-bit pixels, which TGA does not define.`);
  };

  let at = 18 + idLength;
  const palette = new Uint8Array(mapLength * 4);
  if (mapType === 1) {
    const step = Math.ceil(mapBits / 8);
    enough(bytes, at, mapLength * step);
    for (let i = 0; i < mapLength; i++) colour(palette, i * 4, at + i * step, mapBits, false);
    at += mapLength * step;
  }
  const step = Math.ceil(bits / 8);
  if (step < 1 || step > 4) fail(`It stores ${bits}-bit pixels, which TGA does not define.`);
  const right = (descriptor & 0x10) !== 0;
  const top = (descriptor & 0x20) !== 0;
  /** Pixel `n` in file order, from the bytes at `p`. */
  const put = (/** @type {number} */ n, /** @type {number} */ p) => {
    const x = n % width;
    const y = (n - x) / width;
    const o = ((top ? y : height - 1 - y) * width + (right ? width - 1 - x : x)) * 4;
    if (base !== 1) return colour(out, o, p, bits, grey);
    const index =
      (step === 1 ? (bytes[p] ?? 0) : (bytes[p] ?? 0) | ((bytes[p + 1] ?? 0) << 8)) - mapFirst;
    out.set(
      index >= 0 && index < mapLength ? palette.subarray(index * 4, index * 4 + 4) : [0, 0, 0, 255],
      o,
    );
  };

  const total = width * height;
  if (!rle) {
    enough(bytes, at, total * step);
    for (let n = 0; n < total; n++, at += step) put(n, at);
  } else
    for (let n = 0; n < total; ) {
      enough(bytes, at, 1 + step);
      const header = bytes[at++] ?? 0;
      const count = (header & 0x7f) + 1;
      if (header & 0x80) {
        for (let i = 0; i < count && n < total; i++) put(n++, at);
        at += step;
      } else {
        enough(bytes, at, count * step);
        for (let i = 0; i < count && n < total; i++, at += step) put(n++, at);
      }
    }
  // A 32-bit file that says it has no alpha, and whose alpha bytes are all zero, is opaque.
  if (bits === 32 && alphaBits === 0 && out.every((v, i) => i % 4 !== 3 || v === 0))
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
  const name = base === 1 ? "colour-mapped" : grey ? "greyscale" : alphaBits ? "RGBA" : "RGB";
  return { width, height, rgba: out, depth: `${bits}-bit ${name}${rle ? ", RLE" : ""}` };
}
