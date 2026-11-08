// XPRESS with Huffman coding (LZ77+Huffman), as Microsoft's [MS-XCA] section 2.2 describes it and
// WIM images compress their chunks: a 256-byte table of 512 code lengths every 64 KiB of output,
// then 16-bit little-endian words read through a 32-bit register, with long match lengths in bytes.
import { Huffman } from "./huffman.js";

const BLOCK = 65536;

/** @param {string} why */
const damaged = (why) => new Error(`The XPRESS data is damaged: ${why}.`);

/**
 * Decode an XPRESS Huffman stream into exactly `size` bytes.
 * @param {Uint8Array} src @param {number} size @returns {Uint8Array}
 */
export function xpressHuffman(src, size) {
  const out = new Uint8Array(size);
  const end = src.length;
  /** A 16-bit word; past the end it reads as 0, and a read far past the end is damage. */
  const word = (/** @type {number} */ at) => {
    if (at + 2 > end) {
      if (at > end + 4) throw damaged("the data ends early");
      return 0;
    }
    return /** @type {number} */ (src[at]) | /** @type {number} */ (src[at + 1] << 8);
  };
  const lengths = new Uint8Array(512);
  let op = 0;
  let block = 0;
  while (op < size) {
    if (block + 256 > end) throw damaged("the data ends before its Huffman table");
    for (let i = 0; i < 256; i++) {
      const b = /** @type {number} */ (src[block + i]);
      lengths[2 * i] = b & 15;
      lengths[2 * i + 1] = b >>> 4;
    }
    const huffman = new Huffman(lengths, 15, 11, damaged);
    let at = block + 256;
    let bits = ((word(at) << 16) | word(at + 2)) >>> 0;
    at += 4;
    let extra = 16;
    const stop = Math.min(size, op + BLOCK);
    while (op < stop) {
      const e = huffman.entry(bits >>> 17);
      const n = e & 31;
      const symbol = e >>> 5;
      bits = (bits << n) >>> 0;
      extra -= n;
      if (extra < 0) {
        bits = (bits | (word(at) << -extra)) >>> 0;
        extra += 16;
        at += 2;
      }
      if (symbol < 256) {
        out[op++] = symbol;
        continue;
      }
      let length = (symbol - 256) & 15;
      const offsetBits = (symbol - 256) >>> 4;
      if (length === 15) {
        if (at >= end) throw damaged("a match length is cut off");
        length = /** @type {number} */ (src[at++]);
        if (length === 255) {
          if (at + 2 > end) throw damaged("a match length is cut off");
          length = word(at);
          at += 2;
          if (length === 0) {
            if (at + 4 > end) throw damaged("a match length is cut off");
            length = (word(at) | (word(at + 2) << 16)) >>> 0;
            at += 4;
          }
          if (length < 15) throw damaged("a match length is out of range");
          length -= 15;
        }
        length += 15;
      }
      length += 3;
      let offset = 1;
      if (offsetBits) {
        offset = (bits >>> (32 - offsetBits)) + (1 << offsetBits);
        bits = (bits << offsetBits) >>> 0;
        extra -= offsetBits;
        if (extra < 0) {
          bits = (bits | (word(at) << -extra)) >>> 0;
          extra += 16;
          at += 2;
        }
      }
      if (offset > op) throw damaged("a match reaches back before the data");
      if (op + length > size) throw damaged("a match runs past the end of the data");
      for (let from = op - offset, k = 0; k < length; k++)
        out[op++] = /** @type {number} */ (out[from++]);
    }
    block = at;
  }
  return out;
}
