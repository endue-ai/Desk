// KTX 1 textures: the first image of the first mip level, when it is uncompressed 8-bit RGBA, RGB,
// BGRA, luminance or luminance-alpha. KTX 2 and compressed textures open the details view.
import { ascii, fail, has, reader } from "../bytes.js";
import { canvasFor, enough } from "./pixels.js";

const FORMATS = /** @type {Record<number, [string, number]>} */ ({
  6408: ["RGBA", 4],
  6407: ["RGB", 3],
  32993: ["BGRA", 4],
  6409: ["luminance", 1],
  6410: ["luminance-alpha", 2],
  6403: ["red", 1],
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
  if (type !== 0x1401) fail("Its texels are not 8-bit, which is all Images reads in KTX.");
  const [name, channels] =
    FORMATS[format] ??
    fail(`It uses texture format 0x${format.toString(16)}, which Images does not read.`);
  // The orientation key says whether rows run down (T=d) or up (T=u) from the first one.
  const kv = ascii(bytes, 64, kvBytes);
  const up = /KTXorientation\0[^\0]*T=u/.test(kv);
  const at = 64 + kvBytes + 4;
  const row = Math.ceil((width * channels) / 4) * 4;
  enough(bytes, at, row * height);
  const out = canvasFor(width, height);
  for (let y = 0; y < height; y++) {
    const oy = up ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const p = at + y * row + x * channels;
      const c = (/** @type {number} */ i) => bytes[p + i] ?? 0;
      const px =
        name === "RGBA"
          ? [c(0), c(1), c(2), c(3)]
          : name === "BGRA"
            ? [c(2), c(1), c(0), c(3)]
            : name === "RGB"
              ? [c(0), c(1), c(2), 255]
              : name === "luminance-alpha"
                ? [c(0), c(0), c(0), c(1)]
                : name === "red"
                  ? [c(0), 0, 0, 255]
                  : [c(0), c(0), c(0), 255];
      out.set(px, (oy * width + x) * 4);
    }
  }
  const rows = [];
  if (depth > 1 || faces > 1)
    rows.push({ label: "Shown", value: depth > 1 ? "the first slice" : "the first face" });
  return { width, height, rgba: out, depth: `8-bit ${name}`, rows };
}
