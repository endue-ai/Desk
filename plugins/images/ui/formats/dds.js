// DirectDraw Surface: the first mip level of uncompressed (bit masks, luminance, alpha) and BC1,
// BC2 and BC3 (DXT1 to DXT5) textures, with or without the DX10 header.
import { ascii, fail, reader } from "../bytes.js";
import { canvasFor, enough } from "./pixels.js";

const DXGI = /** @type {Record<number, string>} */ ({
  70: "BC1",
  71: "BC1",
  72: "BC1",
  73: "BC2",
  74: "BC2",
  75: "BC2",
  76: "BC3",
  77: "BC3",
  78: "BC3",
  27: "RGBA8",
  28: "RGBA8",
  29: "RGBA8",
  87: "BGRA8",
  88: "BGRX8",
  90: "BGRA8",
  91: "BGRA8",
});
const FOURCC = /** @type {Record<string, string>} */ ({
  DXT1: "BC1",
  DXT2: "BC2",
  DXT3: "BC2",
  DXT4: "BC3",
  DXT5: "BC3",
});

/** A 5:6:5 colour as RGB. */
const rgb565 = (/** @type {number} */ c) => [
  ((c >> 11) << 3) | (c >> 13),
  (((c >> 5) & 63) << 2) | (((c >> 5) & 63) >> 4),
  ((c & 31) << 3) | ((c & 31) >> 2),
];

/** The four colours of a BC1 colour block; `opaque` blocks (BC2, BC3) always use four. */
function palette(
  /** @type {number} */ c0,
  /** @type {number} */ c1,
  /** @type {boolean} */ opaque,
) {
  const a = rgb565(c0);
  const b = rgb565(c1);
  const mix = (/** @type {number} */ wa, /** @type {number} */ wb, /** @type {number} */ d) =>
    [0, 1, 2].map((i) => Math.floor(((a[i] ?? 0) * wa + (b[i] ?? 0) * wb) / d));
  if (c0 > c1 || opaque)
    return [
      [...a, 255],
      [...b, 255],
      [...mix(2, 1, 3), 255],
      [...mix(1, 2, 3), 255],
    ];
  return [
    [...a, 255],
    [...b, 255],
    [...mix(1, 1, 2), 255],
    [0, 0, 0, 0],
  ];
}

/** Decode 4x4 blocks of `kind` into `out`. */
function blocks(
  /** @type {Uint8Array} */ bytes,
  /** @type {number} */ start,
  /** @type {string} */ kind,
  /** @type {number} */ width,
  /** @type {number} */ height,
  /** @type {Uint8ClampedArray} */ out,
) {
  const r = reader(bytes);
  const size = kind === "BC1" ? 8 : 16;
  const across = Math.max(1, Math.ceil(width / 4));
  const down = Math.max(1, Math.ceil(height / 4));
  enough(bytes, start, across * down * size);
  for (let by = 0; by < down; by++)
    for (let bx = 0; bx < across; bx++) {
      const at = start + (by * across + bx) * size;
      const colourAt = kind === "BC1" ? at : at + 8;
      const colours = palette(r.u16(colourAt), r.u16(colourAt + 2), kind !== "BC1");
      const indices = r.u32(colourAt + 4);
      /** @type {number[]} */
      let alphas = [];
      if (kind === "BC3") {
        const [a0, a1] = [r.u8(at), r.u8(at + 1)];
        alphas = [a0, a1];
        if (a0 > a1)
          for (let i = 1; i < 7; i++) alphas.push(Math.floor(((7 - i) * a0 + i * a1) / 7));
        else {
          for (let i = 1; i < 5; i++) alphas.push(Math.floor(((5 - i) * a0 + i * a1) / 5));
          alphas.push(0, 255);
        }
      }
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3);
        const y = by * 4 + (i >> 2);
        if (x >= width || y >= height) continue;
        const px = [...(colours[(indices >> (i * 2)) & 3] ?? [0, 0, 0, 0])];
        if (kind === "BC2") px[3] = ((r.u8(at + (i >> 1)) >> ((i & 1) * 4)) & 15) * 17;
        else if (kind === "BC3") {
          const bit = i * 3;
          const lo = r.u32(at + 2) + r.u16(at + 6) * 2 ** 32;
          px[3] = alphas[Math.floor(lo / 2 ** bit) & 7] ?? 255;
        }
        out.set(px, (y * width + x) * 4);
      }
    }
}

/** The shift and width of a bit mask, to scale its channel to 8 bits. */
function channel(/** @type {number} */ mask) {
  if (!mask) return null;
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  let bits = 0;
  while ((mask >>> (shift + bits)) & 1) bits++;
  return { shift, max: 2 ** bits - 1 };
}

/** @returns {import("./pixels.js").Pixels} */
export function decodeDds(/** @type {Uint8Array} */ bytes) {
  const r = reader(bytes);
  const height = r.u32(12);
  const width = r.u32(16);
  const flags = r.u32(80);
  const fourcc = ascii(bytes, 84, 4);
  const out = canvasFor(width, height);
  let start = 128;
  let kind = "";
  if (flags & 4) {
    if (fourcc === "DX10") {
      const format = r.u32(128);
      kind = DXGI[format] ?? fail(`It uses DXGI format ${format}, which Images does not read.`);
      start = 148;
    } else
      kind =
        FOURCC[fourcc] ??
        fail(`It uses ${fourcc.trim() || "a"} compression, which Images does not read.`);
  }
  if (kind.startsWith("BC")) {
    blocks(bytes, start, kind, width, height, out);
    return { width, height, rgba: out, depth: kind };
  }
  const order = {
    RGBA8: [0xff, 0xff00, 0xff0000, 0xff000000],
    BGRA8: [0xff0000, 0xff00, 0xff, 0xff000000],
    BGRX8: [0xff0000, 0xff00, 0xff, 0],
  }[kind];
  const bits = order ? 32 : r.u32(88);
  const masks = order ?? [r.u32(92), r.u32(96), r.u32(100), flags & 3 ? r.u32(104) : 0];
  const luminance = !order && (flags & 0x20000) !== 0;
  const alphaOnly = !order && (flags & 2) !== 0 && !(flags & 0x40) && !luminance;
  const step = bits / 8;
  if (![1, 2, 3, 4].includes(step))
    fail(`It stores ${bits}-bit pixels, which Images does not read.`);
  enough(bytes, start, width * height * step);
  const [cr, cg, cb, ca] = masks.map(channel);
  for (let i = 0; i < width * height; i++) {
    const at = start + i * step;
    let v = 0;
    for (let k = step - 1; k >= 0; k--) v = v * 256 + (bytes[at + k] ?? 0);
    const get = (
      /** @type {{ shift: number, max: number } | null | undefined} */ c,
      fallback = 0,
    ) => (c ? Math.round(((Math.floor(v / 2 ** c.shift) & c.max) * 255) / c.max) : fallback);
    const red = get(cr);
    const p = i * 4;
    if (alphaOnly) out.set([255, 255, 255, get(ca ?? channel(r.u32(104)))], p);
    else if (luminance) out.set([red, red, red, get(ca, 255)], p);
    else out.set([red, get(cg), get(cb), get(ca, 255)], p);
  }
  const colour = luminance ? "luminance" : alphaOnly ? "alpha" : ca ? "RGBA" : "RGB";
  return { width, height, rgba: out, depth: `${bits}-bit ${colour}, uncompressed` };
}
