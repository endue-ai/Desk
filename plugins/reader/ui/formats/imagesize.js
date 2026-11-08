// An image's pixel size from its header, without decoding it: PNG, GIF, JPEG, WebP and BMP. Pages
// are laid out at this size before they are drawn.
import { ascii, u16, u16le, u32, u32le } from "./bytes.js";

/** @typedef {{ width: number, height: number }} Size */

/** @param {Uint8Array} b @returns {Size | undefined} */
export function imageSize(b) {
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return { width: u32(b, 16), height: u32(b, 20) };
  if (ascii(b, 0, 3) === "GIF") return { width: u16le(b, 6), height: u16le(b, 8) };
  if (ascii(b, 0, 2) === "BM") return { width: u32le(b, 18), height: Math.abs(u32le(b, 22) | 0) };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return webp(b);
  if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
  return undefined;
}

function webp(/** @type {Uint8Array} */ b) {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X")
    return {
      width: 1 + (b[24] ?? 0) + ((b[25] ?? 0) << 8) + ((b[26] ?? 0) << 16),
      height: 1 + (b[27] ?? 0) + ((b[28] ?? 0) << 8) + ((b[29] ?? 0) << 16),
    };
  if (chunk === "VP8L") {
    const bits = u32le(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  return undefined;
}

function jpeg(/** @type {Uint8Array} */ b) {
  for (let at = 2; at + 9 < b.length; ) {
    if (b[at] !== 0xff) return undefined;
    const marker = b[at + 1] ?? 0;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = u16(b, at + 2);
    // SOF0-SOF15 carry the size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { width: u16(b, at + 7), height: u16(b, at + 5) };
    at += 2 + length;
  }
  return undefined;
}
