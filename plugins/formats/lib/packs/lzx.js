// LZX as WIM images use it, from Microsoft's description of the format ([MS-PATCH] sections 2.1 to
// 2.7, the LZX that cabinets use) with WIM's differences: every chunk stands alone (repeated offsets
// and tree lengths start afresh), E8 translation is always on with a size of 12,000,000 and no
// header bit, a block's size is one bit (set: 32,768) or 16 bits, and matches are at most 257 long.
import { Huffman } from "./huffman.js";

const E8_SIZE = 12000000;
const LENGTHS = 249;
const PRETREE = 20;

/** @param {string} why */
const damaged = (why) => new Error(`The LZX data is damaged: ${why}.`);

/** Footer bits and base positions of the position slots, and how many slots a window has. */
const FOOTER = new Uint8Array(51);
const BASE = new Uint32Array(51);
for (let s = 0; s < 51; s++) {
  FOOTER[s] = s < 4 ? 0 : Math.min(17, (s - 2) >> 1);
  if (s) BASE[s] = /** @type {number} */ (BASE[s - 1]) + 2 ** /** @type {number} */ (FOOTER[s - 1]);
}
/** @param {number} window */
export function positionSlots(window) {
  let s = 0;
  while (s < 50 && /** @type {number} */ (BASE[s]) < window) s++;
  return s;
}

/** Bits of 16-bit little-endian words, most significant first. */
class Bits {
  /** @param {Uint8Array} src */
  constructor(src) {
    this.src = src;
    this.pos = 0;
    this.buf = 0;
    this.count = 0;
  }
  /** @param {number} n at most 17 */
  peek(n) {
    while (this.count < n) {
      const src = this.src;
      let w = 0;
      if (this.pos + 1 < src.length)
        w = /** @type {number} */ (src[this.pos]) | /** @type {number} */ (src[this.pos + 1] << 8);
      else if (this.pos > src.length + 4) throw damaged("the data ends early");
      this.pos += 2;
      this.buf = (((this.buf & ((1 << this.count) - 1)) << 16) | w) >>> 0;
      this.count += 16;
    }
    return (this.buf >>> (this.count - n)) & ((1 << n) - 1);
  }
  /** @param {number} n */
  read(n) {
    if (!n) return 0;
    const v = this.peek(n);
    this.count -= n;
    return v;
  }
  /** The next symbol of a tree. @param {Huffman} tree */
  decode(tree) {
    const e = tree.entry(this.peek(16));
    this.count -= e & 31;
    return e >>> 5;
  }
  /** Skip to the next 16-bit boundary (1 to 16 bits) and answer the byte position there. */
  align() {
    const used = this.pos * 8 - this.count;
    this.pos = ((used >> 4) + 1) * 2;
    this.count = 0;
    this.buf = 0;
    return this.pos;
  }
}

/**
 * Read a run of tree lengths through a pretree, as deltas from the previous lengths.
 * @param {Bits} bits @param {Uint8Array} lens @param {number} from @param {number} to
 */
function readLengths(bits, lens, from, to) {
  const pre = new Uint8Array(PRETREE);
  for (let i = 0; i < PRETREE; i++) pre[i] = bits.read(4);
  const tree = new Huffman(pre, 16, 8, damaged);
  for (let i = from; i < to; ) {
    const code = bits.decode(tree);
    if (code === 17 || code === 18) {
      const n = code === 17 ? 4 + bits.read(4) : 20 + bits.read(5);
      if (i + n > to) throw damaged("a run of tree lengths is too long");
      lens.fill(0, i, i + n);
      i += n;
    } else if (code === 19) {
      const n = 4 + bits.read(1);
      const delta = bits.decode(tree);
      if (delta > 16) throw damaged("a run of tree lengths is malformed");
      if (i + n > to) throw damaged("a run of tree lengths is too long");
      lens.fill(/** @type {number} */ (lens[i] - delta + 17) % 17, i, i + n);
      i += n;
    } else {
      lens[i] = /** @type {number} */ (lens[i] - code + 17) % 17;
      i++;
    }
  }
}

/**
 * Undo the E8 call translation over a decoded chunk.
 * @param {Uint8Array} out
 */
function untranslate(out) {
  const size = out.length;
  if (size <= 10) return;
  for (let i = 0; i < size - 10; i++) {
    if (out[i] !== 0xe8) continue;
    const value =
      /** @type {number} */ (out[i + 1]) |
      /** @type {number} */ (out[i + 2] << 8) |
      /** @type {number} */ (out[i + 3] << 16) |
      /** @type {number} */ (out[i + 4] << 24);
    if (value >= -i && value < E8_SIZE) {
      const d = value >= 0 ? value - i : value + E8_SIZE;
      out[i + 1] = d & 0xff;
      out[i + 2] = (d >>> 8) & 0xff;
      out[i + 3] = (d >>> 16) & 0xff;
      out[i + 4] = (d >>> 24) & 0xff;
    }
    i += 4;
  }
}

/**
 * Decode one WIM chunk of LZX into exactly `size` bytes.
 * @param {Uint8Array} src @param {number} size @param {number} [window] the window: the WIM's chunk size
 * @returns {Uint8Array}
 */
export function lzxWim(src, size, window = 32768) {
  if (window < 32768 || window > 2 ** 21 || size > window)
    throw damaged("the window size is out of range");
  const slots = positionSlots(window);
  const main = new Uint8Array(256 + 8 * slots);
  const lens = new Uint8Array(LENGTHS);
  const aligned = new Uint8Array(8);
  const out = new Uint8Array(size);
  const bits = new Bits(src);
  let r0 = 1;
  let r1 = 1;
  let r2 = 1;
  let pos = 0;
  let blockEnd = 0;
  while (pos < size) {
    const type = bits.read(3);
    let blockSize = 32768;
    if (!bits.read(1)) {
      blockSize = bits.read(16);
      if (window >= 65536) blockSize = (blockSize << 8) | bits.read(8);
    }
    if (!blockSize) throw damaged("a block is empty");
    blockEnd = Math.min(size, blockEnd + blockSize);
    if (type === 3) {
      let at = bits.align();
      if (at + 12 > src.length) throw damaged("an uncompressed block is cut off");
      const u32 = (/** @type {number} */ o) =>
        /** @type {number} */ (
          src[o] |
            /** @type {number} */ (src[o + 1] << 8) |
            /** @type {number} */ (src[o + 2] << 16) |
            /** @type {number} */ (src[o + 3] << 24)
        ) >>> 0;
      r0 = u32(at);
      r1 = u32(at + 4);
      r2 = u32(at + 8);
      at += 12;
      const n = blockEnd - pos;
      if (n < 0) throw damaged("a match runs past an uncompressed block");
      if (at + n > src.length) throw damaged("an uncompressed block is cut off");
      out.set(src.subarray(at, at + n), pos);
      pos += n;
      bits.pos = at + n + (blockSize & 1);
      continue;
    }
    if (type !== 1 && type !== 2) throw damaged(`a block has the unknown type ${type}`);
    let alignedTree;
    if (type === 2) {
      for (let i = 0; i < 8; i++) aligned[i] = bits.read(3);
      alignedTree = new Huffman(aligned, 16, 7, damaged);
    }
    readLengths(bits, main, 0, 256);
    readLengths(bits, main, 256, main.length);
    const mainTree = new Huffman(main, 16, 11, damaged);
    readLengths(bits, lens, 0, LENGTHS);
    const lengthTree = new Huffman(lens, 16, 10, damaged);
    while (pos < blockEnd) {
      const symbol = bits.decode(mainTree);
      if (symbol < 256) {
        out[pos++] = symbol;
        continue;
      }
      const header = (symbol - 256) & 7;
      const slot = (symbol - 256) >>> 3;
      const length = header === 7 ? bits.decode(lengthTree) + 9 : header + 2;
      let offset;
      if (slot === 0) offset = r0;
      else if (slot === 1) {
        offset = r1;
        r1 = r0;
        r0 = offset;
      } else if (slot === 2) {
        offset = r2;
        r2 = r0;
        r0 = offset;
      } else {
        const footer = /** @type {number} */ (FOOTER[slot]);
        let formatted = /** @type {number} */ (BASE[slot]);
        if (alignedTree && footer >= 3)
          formatted += (bits.read(footer - 3) << 3) + bits.decode(alignedTree);
        else formatted += bits.read(footer);
        offset = formatted - 2;
        r2 = r1;
        r1 = r0;
        r0 = offset;
      }
      if (offset > pos || offset <= 0) throw damaged("a match reaches back before the data");
      if (pos + length > size) throw damaged("a match runs past the end of the data");
      for (let from = pos - offset, k = 0; k < length; k++)
        out[pos++] = /** @type {number} */ (out[from++]);
    }
  }
  untranslate(out);
  return out;
}
