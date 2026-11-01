// KTX 1 textures: the first image (first face, slice and mip level) when it is uncompressed:
// 8-bit RGBA, RGB, BGRA, red, RG, luminance or luminance-alpha, and half or float texels, which are
// tone-mapped. KTX 2 and compressed textures open the details view.
import { ascii, fail, has, reader } from "../bytes.js";
import { half } from "./exr.js";
import { canvasFor, enough } from "./pixels.js";
import { toneMap } from "./tonemap.js";

/** Texture format: its name and which RGBA channel each component fills. */
const FORMATS = /** @type {Record<number, [string, number[]]>} */ ({
  6408: ["RGBA", [0, 1, 2, 3]],
  6407: ["RGB", [0, 1, 2]],
  32993: ["BGRA", [2, 1, 0, 3]],
  6403: ["red", [0]],
  33319: ["RG", [0, 1]],
  6409: ["luminance", [0, 1, 2]],
  6410: ["luminance-alpha", [0, 1, 2, 3]],
});
const TYPES = /** @type {Record<number, [string, number]>} */ ({
  5121: ["8-bit", 1],
  5131: ["half", 2],
  5126: ["float", 4],
});

/** @returns {import("./pixels.js").Pixels} */
export function decodeKtx(/** @type {Uint8Array} */ bytes) {
  if (has(bytes, 1, "KTX 20")) fail("It is KTX 2; Images reads KTX 1.");
  if (!has(bytes, 1, "KTX 11")) fail("Its KTX identifier is damaged.");
  const le = reader(bytes).u32(12) === 0x04030201;
  const r = reader(bytes, le);
  const [type, format, internal] = [r.u32(16), r.u32(24), r.u32(28)];
  const [width, height, depth] = [r.u32(36), Math.max(1, r.u32(40)), r.u32(44)];
  const [faces, kvBytes] = [r.u32(52), r.u32(60)];
  if (type === 0)
    fail(
      `It holds compressed textures (format 0x${internal.toString(16)}), which Images does not read.`,
    );
  const [kind, size] =
    TYPES[type] ??
    fail(`Its texels are of type 0x${type.toString(16)}, which Images does not read.`);
  const [name, slots] =
    FORMATS[format] ??
    fail(`It uses texture format 0x${format.toString(16)}, which Images does not read.`);
  // Luminance fills R, G and B from one component; luminance-alpha adds alpha from the second.
  const components = name === "luminance" ? 1 : name === "luminance-alpha" ? 2 : slots.length;
  // The orientation key says whether rows run down (T=d) or up (T=u) from the first one.
  const up = /KTXorientation\0[^\0]*T=u/.test(ascii(bytes, 64, kvBytes));
  const at = 64 + kvBytes + 4;
  const row = Math.ceil((width * components * size) / 4) * 4;
  enough(bytes, at, row * height);
  canvasFor(width, height);
  const float = new Float32Array(width * height * 4);
  const read = (/** @type {number} */ p) =>
    size === 1 ? r.u8(p) / 255 : size === 2 ? half(r.u16(p)) : r.f32(p);
  for (let y = 0; y < height; y++) {
    const oy = up ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const o = (oy * width + x) * 4;
      float[o + 3] = 1;
      for (let c = 0; c < components; c++) {
        const v = read(at + y * row + (x * components + c) * size);
        if (name === "luminance" || (name === "luminance-alpha" && c === 0))
          float.fill(v, o, o + 3);
        else if (name === "luminance-alpha") float[o + 3] = v;
        else float[o + (slots[c] ?? 0)] = v;
      }
    }
  }
  const rows = [];
  if (depth > 1 || faces > 1)
    rows.push({
      label: "Shown",
      value: depth > 1 ? "the first slice" : `the first of ${faces} faces`,
    });
  if (size === 1) {
    // 8-bit texels are shown as they are, not tone-mapped.
    const rgba = canvasFor(width, height);
    for (let i = 0; i < float.length; i++) rgba[i] = (float[i] ?? 0) * 255;
    return { width, height, rgba, depth: `8-bit ${name}`, rows };
  }
  return {
    width,
    height,
    rgba: toneMap(float, width * height),
    float,
    depth: `${kind} ${name}, tone-mapped`,
    rows,
  };
}
