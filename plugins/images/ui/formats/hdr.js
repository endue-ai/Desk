// Radiance RGBE (.hdr): the text header, then scanlines that are flat, old-style run-length or
// adaptive (new) run-length encoded; to float, then tone-mapped.
import { ascii, fail } from "../bytes.js";
import { canvasFor } from "./pixels.js";
import { toneMap } from "./tonemap.js";

/** @returns {import("./pixels.js").Pixels} */
export function decodeHdr(/** @type {Uint8Array} */ bytes) {
  const head = ascii(bytes, 0, Math.min(bytes.length, 65536));
  const blank = head.indexOf("\n\n");
  if (blank < 0) fail("Its header never ends.");
  const lines = head.slice(0, blank).split("\n");
  const format = lines
    .find((l) => l.startsWith("FORMAT="))
    ?.slice(7)
    .trim();
  if (format && format !== "32-bit_rle_rgbe") fail(`It is ${format}, which Images does not read.`);
  const sizeEnd = head.indexOf("\n", blank + 2);
  const size = head
    .slice(blank + 2, sizeEnd)
    .trim()
    .match(/^([+-])Y (\d+) \+X (\d+)$/);
  if (!size) fail("It stores its rows in an order Images does not read.");
  const bottomUp = size[1] === "+";
  const height = Number(size[2]);
  const width = Number(size[3]);
  canvasFor(width, height);
  const float = new Float32Array(width * height * 4);
  const line = new Uint8Array(width * 4);
  let at = sizeEnd + 1;
  const short = () => fail("The file ends before its pixels do.");

  for (let y = 0; y < height; y++) {
    if (at + 4 > bytes.length) short();
    const adaptive =
      width >= 8 &&
      width < 32768 &&
      bytes[at] === 2 &&
      bytes[at + 1] === 2 &&
      (((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) === width;
    if (adaptive) {
      at += 4;
      for (let c = 0; c < 4; c++)
        for (let x = 0; x < width; ) {
          if (at >= bytes.length) short();
          let count = bytes[at++] ?? 0;
          if (count > 128) {
            count -= 128;
            const v = bytes[at++] ?? 0;
            for (let i = 0; i < count && x < width; i++) line[x++ * 4 + c] = v;
          } else {
            if (count === 0 || at + count > bytes.length) short();
            for (let i = 0; i < count && x < width; i++) line[x++ * 4 + c] = bytes[at++] ?? 0;
          }
        }
    } else {
      let shift = 0;
      for (let x = 0; x < width; ) {
        if (at + 4 > bytes.length) short();
        if (bytes[at] === 1 && bytes[at + 1] === 1 && bytes[at + 2] === 1) {
          const count = (bytes[at + 3] ?? 0) << shift;
          for (let i = 0; i < count && x > 0 && x < width; i++, x++)
            line.copyWithin(x * 4, (x - 1) * 4, x * 4);
          shift += 8;
        } else {
          line.set(bytes.subarray(at, at + 4), x * 4);
          x++;
          shift = 0;
        }
        at += 4;
      }
    }
    const row = bottomUp ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const e = line[x * 4 + 3] ?? 0;
      const f = e ? 2 ** (e - 136) : 0;
      const p = (row * width + x) * 4;
      float[p] = (line[x * 4] ?? 0) * f;
      float[p + 1] = (line[x * 4 + 1] ?? 0) * f;
      float[p + 2] = (line[x * 4 + 2] ?? 0) * f;
      float[p + 3] = 1;
    }
  }
  return {
    width,
    height,
    rgba: toneMap(float, width * height),
    float,
    depth: "32-bit RGBE, tone-mapped",
  };
}
