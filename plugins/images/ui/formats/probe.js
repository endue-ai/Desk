// What the details say about the formats the webview decodes, read from their headers: pixel size,
// bit depth and colour type, and the frame count where the format keeps one. The webview draws them;
// these readers never decode pixels.
import { ascii, has, reader } from "../bytes.js";
import { heif } from "./isobmff.js";
import { openTiff } from "./tiff.js";

/**
 * @typedef {{ width?: number, height?: number, depth?: string, frames?: number, animated?: boolean,
 *   rotation?: number, flipped?: boolean, apng?: boolean }} Probe
 */

const PNG_COLOUR = ["greyscale", "", "RGB", "indexed", "greyscale with alpha", "", "RGBA"];

/** @returns {Probe} */
function png(/** @type {Uint8Array} */ b) {
  const r = reader(b, false);
  const depth = `${r.u8(24)}-bit ${PNG_COLOUR[r.u8(25)] ?? "colour"}`;
  /** @type {Probe} */
  const out = { width: r.u32(16), height: r.u32(20), depth };
  for (let at = 8; at + 12 <= b.length; ) {
    const length = r.u32(at);
    const type = ascii(b, at + 4, 4);
    if (type === "acTL") Object.assign(out, { frames: r.u32(at + 8), animated: true, apng: true });
    if (type === "IDAT" || type === "IEND") break;
    at += 12 + length;
  }
  return out;
}

/** @returns {Probe} */
function jpeg(/** @type {Uint8Array} */ b) {
  const r = reader(b, false);
  for (let at = 2; at + 9 <= b.length; ) {
    if (b[at] !== 0xff) return {};
    const marker = b[at + 1] ?? 0;
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const components = r.u8(at + 9);
      const colour = components === 1 ? "greyscale" : components === 4 ? "CMYK" : "colour";
      const kind = marker === 0xc2 ? ", progressive" : "";
      return {
        width: r.u16(at + 7),
        height: r.u16(at + 5),
        depth: `${r.u8(at + 4)}-bit ${colour}${kind}`,
      };
    }
    if (marker === 0xda || marker === 0xd9) break;
    at += 2 + r.u16(at + 2);
  }
  return {};
}

/** @returns {Probe} */
function gif(/** @type {Uint8Array} */ b) {
  const r = reader(b);
  const packed = r.u8(10);
  let at = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
  let frames = 0;
  const skipBlocks = () => {
    while (at < b.length && b[at] !== 0) at += (b[at] ?? 0) + 1;
    at++;
  };
  while (at < b.length) {
    const kind = b[at];
    if (kind === 0x2c) {
      frames++;
      const local = b[at + 9] ?? 0;
      at += 10 + (local & 0x80 ? 3 * 2 ** ((local & 7) + 1) : 0) + 1;
      skipBlocks();
    } else if (kind === 0x21) {
      at += 2;
      skipBlocks();
    } else break;
  }
  return {
    width: r.u16(6),
    height: r.u16(8),
    depth: `${(packed & 7) + 1}-bit indexed`,
    frames,
    animated: frames > 1,
  };
}

/** @returns {Probe} */
function webp(/** @type {Uint8Array} */ b) {
  const r = reader(b);
  /** @type {Probe} */
  const out = {};
  let frames = 0;
  let alpha = false;
  for (let at = 12; at + 8 <= b.length; ) {
    const type = ascii(b, at, 4);
    const length = r.u32(at + 4);
    const body = at + 8;
    if (type === "VP8X") {
      alpha = (r.u8(body) & 0x10) !== 0;
      out.width = (r.u32(body + 4) & 0xffffff) + 1;
      out.height = (r.u32(body + 7) & 0xffffff) + 1;
    } else if (type === "VP8 " && out.width === undefined) {
      out.width = r.u16(body + 6) & 0x3fff;
      out.height = r.u16(body + 8) & 0x3fff;
      out.depth = "8-bit RGB, lossy";
    } else if (type === "VP8L" && out.width === undefined) {
      const bits = r.u32(body + 1);
      out.width = (bits & 0x3fff) + 1;
      out.height = ((bits >> 14) & 0x3fff) + 1;
      alpha = ((bits >> 28) & 1) === 1;
      out.depth = `8-bit ${alpha ? "RGBA" : "RGB"}, lossless`;
    } else if (type === "ANMF") frames++;
    else if (type === "ALPH") alpha = true;
    at = body + length + (length % 2);
  }
  out.depth ??= `8-bit ${alpha ? "RGBA" : "RGB"}`;
  if (frames > 0) Object.assign(out, { frames, animated: frames > 1 });
  return out;
}

/** @returns {Probe} */
function bmp(/** @type {Uint8Array} */ b) {
  const r = reader(b);
  const header = r.u32(14);
  if (header === 12) return { width: r.u16(18), height: r.u16(20), depth: `${r.u16(24)}-bit` };
  const bits = r.u16(28);
  return {
    width: Math.abs(r.i32(18)),
    height: Math.abs(r.i32(22)),
    depth: `${bits}-bit ${bits <= 8 ? "indexed" : "RGB"}`,
  };
}

/** ICO and CUR: the largest of their images. */
function ico(/** @type {Uint8Array} */ b) {
  const r = reader(b);
  const count = r.u16(4);
  /** @type {Probe} */
  let best = { frames: count };
  for (let i = 0; i < Math.min(count, 256); i++) {
    const at = 6 + i * 16;
    if (at + 16 > b.length) break;
    let width = r.u8(at) || 256;
    let height = r.u8(at + 1) || 256;
    const offset = r.u32(at + 12);
    if (has(b, offset, [0x89, 0x50, 0x4e, 0x47]))
      ({ width = width, height = height } = png(b.subarray(offset)));
    if (width * height > (best.width ?? 0) * (best.height ?? 0))
      best = { width, height, frames: count, depth: `${r.u16(at + 6) || 32}-bit` };
  }
  return best;
}

/** @returns {Probe} */
function heifProbe(/** @type {Uint8Array} */ b) {
  const info = heif(b)?.primaryInfo();
  if (!info) return {};
  const colour = info.channels === 1 ? "greyscale" : info.channels === 4 ? "RGBA" : "colour";
  return {
    width: info.width,
    height: info.height,
    depth: info.bits ? `${info.bits}-bit ${colour}` : undefined,
    rotation: info.rotation,
    flipped: info.flipped,
  };
}

const PHOTOMETRIC = ["greyscale", "greyscale", "RGB", "indexed", "mask", "CMYK", "YCbCr"];

/** @returns {Probe} */
function tiff(/** @type {Uint8Array} */ b) {
  const file = openTiff(b);
  const chain = file.chain();
  const ifd0 = chain[0];
  if (!ifd0) return {};
  const bits = ifd0.number(0x102) ?? 1;
  const samples = ifd0.number(0x115) ?? 1;
  const colour = PHOTOMETRIC[ifd0.number(0x106) ?? 2] ?? "colour";
  const alpha = samples > (colour === "RGB" ? 3 : colour === "CMYK" ? 4 : 1) ? " with alpha" : "";
  return {
    width: ifd0.number(0x100),
    height: ifd0.number(0x101),
    depth: `${bits}-bit ${colour}${alpha}`,
    frames: chain.length,
  };
}

/** SVG: the root element's width and height, else its viewBox. */
function svg(/** @type {string} */ text) {
  const root = text.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const attr = (/** @type {string} */ name) =>
    root.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
  const px = (/** @type {string | undefined} */ v) =>
    v && /^\s*[\d.]+\s*(px)?\s*$/.test(v) ? Number.parseFloat(v) : undefined;
  const box = attr("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = px(attr("width")) ?? (box?.length === 4 ? box[2] : undefined);
  const height = px(attr("height")) ?? (box?.length === 4 ? box[3] : undefined);
  return {
    width: width ? Math.round(width) : undefined,
    height: height ? Math.round(height) : undefined,
    depth: "vector",
  };
}

/** JPEG XL: the codestream's SizeHeader, in a bare codestream or the container's jxlc/jxlp box. */
function jxl(/** @type {Uint8Array} */ b) {
  let start = 0;
  if (!has(b, 0, [0xff, 0x0a])) {
    const r = reader(b, false);
    for (let at = 0; at + 8 <= b.length; ) {
      const size = r.u32(at) || b.length - at;
      const type = ascii(b, at + 4, 4);
      if (type === "jxlc") start = at + 8;
      if (type === "jxlp") start = at + 12;
      if (start || size < 8) break;
      at += size;
    }
    if (!start) return {};
  }
  let bit = (start + 2) * 8;
  const u = (/** @type {number} */ n) => {
    let v = 0;
    for (let i = 0; i < n; i++, bit++) v |= (((b[bit >> 3] ?? 0) >> (bit & 7)) & 1) << i;
    return v;
  };
  const size = () => [9, 13, 18, 30][u(2)] ?? 9;
  const ratios = [0, 1, 1.2, 4 / 3, 1.5, 16 / 9, 1.25, 2];
  let height;
  let width;
  if (u(1)) {
    height = (u(5) + 1) * 8;
    const ratio = u(3);
    width = ratio ? Math.floor(height * (ratios[ratio] ?? 1)) : (u(5) + 1) * 8;
  } else {
    height = u(size()) + 1;
    const ratio = u(3);
    width = ratio ? Math.floor(height * (ratios[ratio] ?? 1)) : u(size()) + 1;
  }
  return { width, height };
}

/**
 * @param {string} format
 * @param {Uint8Array} bytes
 * @returns {Probe}
 */
export function probe(format, bytes) {
  try {
    if (format === "png") return png(bytes);
    if (format === "jpeg") return jpeg(bytes);
    if (format === "gif") return gif(bytes);
    if (format === "webp") return webp(bytes);
    if (format === "bmp") return bmp(bytes);
    if (format === "ico" || format === "cur") return ico(bytes);
    if (format === "heic" || format === "avif") return heifProbe(bytes);
    if (format === "tiff") return tiff(bytes);
    if (format === "jxl") return jxl(bytes);
    if (format === "svg") return svg(new TextDecoder().decode(bytes.subarray(0, 65536)));
  } catch {
    // A header that does not parse leaves the size to the webview, once it has decoded the image.
  }
  return {};
}
