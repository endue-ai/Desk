// Canonical Huffman tables for bzip2: codes up to 20 bits, decoded by peeking 20 bits and finding
// the length whose limit the value falls under.
import { damaged } from "../input.js";

/** @param {Uint8Array} lengths a code length (1..20) per symbol */
export function huffman(lengths) {
  let min = 32;
  let max = 0;
  for (const l of lengths) {
    if (l < min) min = l;
    if (l > max) max = l;
  }
  // limit[l]: the largest code of length l, aligned to 20 bits; base and perm as bzip2 builds them.
  const limit = new Int32Array(22).fill(-1);
  const base = new Int32Array(22);
  const perm = new Int32Array(lengths.length);
  let p = 0;
  for (let l = min; l <= max; l++)
    for (let s = 0; s < lengths.length; s++) if (lengths[s] === l) perm[p++] = s;
  const count = new Int32Array(22);
  for (const l of lengths) count[l]++;
  let code = 0;
  let index = 0;
  for (let l = min; l <= max; l++) {
    base[l] = index - code;
    code += /** @type {number} */ (count[l]);
    index += /** @type {number} */ (count[l]);
    limit[l] = code - 1;
    code <<= 1;
  }
  return {
    /** @param {{ peek(n: number): number, skip(n: number): void }} bits */
    decode(bits) {
      const v = bits.peek(20);
      for (let l = min; l <= max; l++) {
        const c = v >>> (20 - l);
        if (c <= /** @type {number} */ (limit[l])) {
          bits.skip(l);
          const s = c + /** @type {number} */ (base[l]);
          if (s < 0 || s >= perm.length) break;
          return /** @type {number} */ (perm[s]);
        }
      }
      throw damaged("bzip2", "a Huffman code is not in its table");
    },
  };
}
