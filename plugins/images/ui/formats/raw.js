// Camera RAW: the largest embedded JPEG preview a webview decodes (baseline or progressive; never
// the lossless JPEG that DNG and CR2 keep sensor data in). Candidates come from the TIFF IFDs and
// SubIFDs, CR3's PRVW box, the RAF header, and a scan of the whole file for JPEG starts, which also
// finds the previews in maker notes (ORF, PEF) and in CIFF (CRW) and MRW files.
import { has, reader } from "../bytes.js";
import { boxes } from "./isobmff.js";
import { openTiff } from "./tiff.js";

/** @typedef {{ start: number, end: number, width: number, height: number, colour: boolean }} Jpeg */

/** Start-of-frame markers a webview decodes: baseline, extended and progressive Huffman. */
const DECODABLE = new Set([0xc0, 0xc1, 0xc2]);
const FRAMES = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * The JPEG starting at `start`, walked marker by marker to its EOI, or null when it is not one
 * a webview can show.
 * @param {Uint8Array} bytes
 * @param {number} start
 * @returns {Jpeg | null}
 */
export function jpegAt(bytes, start) {
  if (!has(bytes, start, [0xff, 0xd8, 0xff])) return null;
  const r = reader(bytes, false);
  let at = start + 2;
  let width = 0;
  let height = 0;
  let scanned = false;
  let colour = false;
  while (at + 2 <= bytes.length) {
    if (bytes[at] !== 0xff) {
      if (!scanned) return null;
      // Entropy-coded data: the next marker is an FF not followed by 00 or a restart marker.
      const next = bytes.indexOf(0xff, at);
      if (next < 0) return null;
      at = next;
      continue;
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      if (!scanned) return null;
      at += 2;
      continue;
    }
    if (marker === 0xd9)
      return scanned && width > 0 ? { start, end: at + 2, width, height, colour } : null;
    if (marker === 0xd8 || at + 4 > bytes.length) return null;
    const length = r.u16(at + 2);
    if (length < 2 || at + 2 + length > bytes.length) return null;
    if (FRAMES.has(marker)) {
      if (!DECODABLE.has(marker) || length < 8) return null;
      height = r.u16(at + 5);
      width = r.u16(at + 7);
      colour = r.u8(at + 9) >= 3;
      if (width === 0 || height === 0) return null;
    } else if (marker === 0xda) {
      if (width === 0) return null;
      scanned = true;
    } else if (marker < 0xc0) return null;
    at += 2 + length;
  }
  return null;
}

/** Candidate JPEG starts the TIFF structure names: JPEGInterchangeFormat, JPEG strips, JpgFromRaw. */
function fromTiff(/** @type {Uint8Array} */ bytes) {
  /** @type {number[]} */
  const starts = [];
  try {
    for (const ifd of openTiff(bytes).all()) {
      const jif = ifd.number(0x201);
      if (jif) starts.push(jif);
      const strips = ifd.numbers(0x111);
      const compression = ifd.number(0x103);
      if (strips.length === 1 && (compression === 6 || compression === 7))
        starts.push(strips[0] ?? 0);
      const embedded = ifd.entries.get(0x2e);
      if (embedded) starts.push(embedded.at);
    }
  } catch {
    // Not a TIFF after all: the scan still looks.
  }
  return starts;
}

/** CR3's PRVW box, in its preview uuid box: the JPEG follows 16 bytes of header. */
function fromCr3(/** @type {Uint8Array} */ bytes) {
  for (const box of boxes(bytes)) {
    if (box.type !== "uuid" || !has(bytes, box.body, [0xea, 0xf4, 0x2b, 0x5e])) continue;
    for (let at = box.body + 16; at + 8 <= box.end; at++)
      if (has(bytes, at, "PRVW")) return [at + 4 + 16];
  }
  return [];
}

/** The RAF header's JPEG offset, big-endian at 84. */
function fromRaf(/** @type {Uint8Array} */ bytes) {
  return has(bytes, 0, "FUJIFILMCCD-RAW") && bytes.length > 92
    ? [reader(bytes, false).u32(84)]
    : [];
}

/**
 * The largest embedded JPEG a webview shows, or null. Its bytes are `data`: a copy when the file
 * keeps it damaged on purpose (Minolta's MRW thumbnail starts 00 D8 instead of FF D8).
 * @param {Uint8Array} bytes
 * @returns {(Jpeg & { data: Uint8Array }) | null}
 */
export function largestJpeg(bytes) {
  const starts = new Set([...fromTiff(bytes), ...fromCr3(bytes), ...fromRaf(bytes)]);
  for (
    let at = bytes.indexOf(0xff);
    at >= 0 && at + 3 < bytes.length;
    at = bytes.indexOf(0xff, at + 1)
  )
    if (bytes[at + 1] === 0xd8 && bytes[at + 2] === 0xff) starts.add(at);
  /** @type {Jpeg | null} */
  let best = null;
  // Colour first: a one-channel "JPEG" of sensor size is sensor data (older PowerShot CRWs).
  const area = (/** @type {Jpeg} */ j) => j.width * j.height * (j.colour ? 1 : 1e-9);
  for (const start of starts) {
    const jpeg = jpegAt(bytes, start);
    if (!jpeg) continue;
    const longer =
      best && area(jpeg) === area(best) && jpeg.end - jpeg.start > best.end - best.start;
    if (!best || area(jpeg) > area(best) || longer) best = jpeg;
  }
  if (best) return { ...best, data: bytes.subarray(best.start, best.end) };
  if (!has(bytes, 0, "\0MRM")) return null;
  for (
    let at = bytes.indexOf(0xd8);
    at > 0 && at + 2 < bytes.length;
    at = bytes.indexOf(0xd8, at + 1)
  ) {
    if (bytes[at - 1] !== 0 || bytes[at + 1] !== 0xff) continue;
    const copy = bytes.slice(at - 1, Math.min(bytes.length, at - 1 + (1 << 20)));
    copy[0] = 0xff;
    const jpeg = jpegAt(copy, 0);
    if (jpeg)
      return { ...jpeg, start: at - 1, end: at - 1 + jpeg.end, data: copy.subarray(0, jpeg.end) };
  }
  return null;
}

/**
 * The largest uncompressed 8-bit RGB image among the TIFF IFDs: the thumbnail DNG, 3FR and ERF
 * files keep, as RGBA.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, rgba: Uint8ClampedArray } | null}
 */
export function largestStrips(bytes) {
  /** @type {{ width: number, height: number, rgba: Uint8ClampedArray } | null} */
  let best = null;
  try {
    for (const ifd of openTiff(bytes).all()) {
      const [width = 0, height = 0] = [ifd.number(0x100), ifd.number(0x101)];
      const plain =
        (ifd.number(0x103) ?? 1) === 1 &&
        ifd.number(0x106) === 2 &&
        (ifd.number(0x11c) ?? 1) === 1 &&
        ifd.number(0x115) === 3 &&
        ifd.numbers(0x102).every((b) => b === 8);
      if (!plain || width * height === 0 || width * height > 2 ** 25) continue;
      if (best && width * height <= best.width * best.height) continue;
      const counts = ifd.numbers(0x117);
      const rgb = new Uint8Array(width * height * 3);
      let filled = 0;
      ifd.numbers(0x111).forEach((offset, i) => {
        const part = bytes
          .subarray(offset, offset + (counts[i] ?? 0))
          .subarray(0, rgb.length - filled);
        rgb.set(part, filled);
        filled += part.length;
      });
      if (filled < rgb.length) continue;
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let p = 0; p < width * height; p++) {
        rgba[p * 4] = rgb[p * 3] ?? 0;
        rgba[p * 4 + 1] = rgb[p * 3 + 1] ?? 0;
        rgba[p * 4 + 2] = rgb[p * 3 + 2] ?? 0;
        rgba[p * 4 + 3] = 255;
      }
      best = { width, height, rgba };
    }
  } catch {
    // Not a TIFF: no strips to show.
  }
  return best;
}
