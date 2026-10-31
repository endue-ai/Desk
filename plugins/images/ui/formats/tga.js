// Truevision TGA: true colour, greyscale and colour-mapped, raw or RLE, 8, 15, 16, 24 and 32 bits,
// in any of the four corner orders.
import { fail, reader } from "../bytes.js";
import { canvasFor, enough } from "./pixels.js";

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
  const out = canvasFor(width, height);

  /** One colour of `size` bits at `at`, as RGBA. */
  const colour = (
    /** @type {number} */ at,
    /** @type {number} */ size,
    /** @type {boolean} */ grey,
  ) => {
    if (grey) {
      const v = r.u8(at);
      return [v, v, v, size === 16 ? r.u8(at + 1) : 255];
    }
    if (size === 15 || size === 16) {
      const v = r.u16(at);
      const five = (/** @type {number} */ c) => (c << 3) | (c >> 2);
      return [
        five((v >> 10) & 31),
        five((v >> 5) & 31),
        five(v & 31),
        size === 16 && alphaBits ? (v & 0x8000 ? 255 : 0) : 255,
      ];
    }
    if (size === 24) return [r.u8(at + 2), r.u8(at + 1), r.u8(at), 255];
    if (size === 32) return [r.u8(at + 2), r.u8(at + 1), r.u8(at), r.u8(at + 3)];
    return fail(`It stores ${size}-bit pixels, which TGA does not define.`);
  };

  let at = 18 + idLength;
  /** @type {number[][]} */
  const palette = [];
  if (mapType === 1) {
    const step = Math.ceil(mapBits / 8);
    enough(bytes, at, mapLength * step);
    for (let i = 0; i < mapLength; i++) palette.push(colour(at + i * step, mapBits, false));
    at += mapLength * step;
  }
  const step = Math.ceil(bits / 8);
  const pixelAt = (/** @type {number} */ p) => {
    if (base === 1) {
      const index = step === 1 ? r.u8(p) : r.u16(p);
      return palette[index - mapFirst] ?? [0, 0, 0, 255];
    }
    return colour(p, bits, base === 3);
  };

  const total = width * height;
  const right = (descriptor & 0x10) !== 0;
  const top = (descriptor & 0x20) !== 0;
  const put = (/** @type {number} */ n, /** @type {number[]} */ px) => {
    const x = n % width;
    const y = Math.floor(n / width);
    const ox = right ? width - 1 - x : x;
    const oy = top ? y : height - 1 - y;
    out.set(px, (oy * width + ox) * 4);
  };
  let n = 0;
  while (n < total) {
    if (!rle) {
      enough(bytes, at, step);
      put(n++, pixelAt(at));
      at += step;
      continue;
    }
    enough(bytes, at, 1 + step);
    const header = r.u8(at++);
    const count = (header & 0x7f) + 1;
    if (header & 0x80) {
      const px = pixelAt(at);
      at += step;
      for (let i = 0; i < count && n < total; i++) put(n++, px);
    } else {
      enough(bytes, at, count * step);
      for (let i = 0; i < count && n < total; i++, at += step) put(n++, pixelAt(at));
    }
  }
  // A 32-bit file that says it has no alpha, and whose alpha bytes are all zero, is opaque.
  if (bits === 32 && alphaBits === 0 && out.every((v, i) => i % 4 !== 3 || v === 0))
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
  const colourName =
    base === 1 ? "colour-mapped" : base === 3 ? "greyscale" : alphaBits ? "RGBA" : "RGB";
  return { width, height, rgba: out, depth: `${bits}-bit ${colourName}${rle ? ", RLE" : ""}` };
}
