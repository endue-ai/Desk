// The literals section (RFC 8878, 3.1.1.3.1): raw, repeated, or Huffman-coded in one or four
// streams, with the tree's weights written directly or FSE-compressed, or reused ("treeless").
import { damaged } from "../input.js";
import { BackBits } from "./bits.js";
import { readTable } from "./fse.js";

/** @typedef {{ symbols: Uint8Array, lengths: Uint8Array, log: number }} HuffmanTable */
/** @typedef {{ huffman: HuffmanTable | null }} LiteralsState */

const MAX_LOG = 11;
const BLOCK_MAX = 128 * 1024;

/** The weights of a tree description at b[start..end), and how many bytes it took. @param {Uint8Array} b @param {number} start @param {number} end */
function weightsOf(b, start, end) {
  const header = /** @type {number} */ (b[start]);
  const weights = new Uint8Array(256);
  let n = 0;
  let bytes;
  if (header >= 128) {
    n = header - 127;
    bytes = 1 + ((n + 1) >> 1);
    if (start + bytes > end) throw damaged("Zstandard", "a Huffman tree is cut short");
    for (let i = 0; i < n; i++) {
      const byte = /** @type {number} */ (b[start + 1 + (i >> 1)]);
      weights[i] = i & 1 ? byte & 15 : byte >> 4;
    }
  } else {
    bytes = 1 + header;
    if (header === 0 || start + bytes > end)
      throw damaged("Zstandard", "a Huffman tree is cut short");
    const stop = start + bytes;
    const { table, bytes: used } = readTable(b, start + 1, stop, 6, 255);
    const bits = new BackBits(b, start + 1 + used, stop);
    let s1 = bits.read(table.log);
    let s2 = bits.read(table.log);
    for (;;) {
      if (n > 253) throw damaged("Zstandard", "a Huffman tree has too many symbols");
      weights[n++] = /** @type {number} */ (table.symbols[s1]);
      s1 =
        /** @type {number} */ (table.base[s1]) + bits.read(/** @type {number} */ (table.bits[s1]));
      if (bits.pos < 0) {
        weights[n++] = /** @type {number} */ (table.symbols[s2]);
        break;
      }
      weights[n++] = /** @type {number} */ (table.symbols[s2]);
      s2 =
        /** @type {number} */ (table.base[s2]) + bits.read(/** @type {number} */ (table.bits[s2]));
      if (bits.pos < 0) {
        weights[n++] = /** @type {number} */ (table.symbols[s1]);
        break;
      }
    }
  }
  return { weights, n, bytes };
}

/** A Huffman tree description at b[start..end). @param {Uint8Array} b @param {number} start @param {number} end */
export function readHuffman(b, start, end) {
  const { weights, n, bytes } = weightsOf(b, start, end);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const w = /** @type {number} */ (weights[i]);
    if (w > MAX_LOG) throw damaged("Zstandard", "a Huffman weight is too large");
    if (w) sum += 1 << (w - 1);
  }
  if (sum === 0) throw damaged("Zstandard", "a Huffman tree is empty");
  const log = 32 - Math.clz32(sum);
  if (log > MAX_LOG) throw damaged("Zstandard", "a Huffman tree is too deep");
  const left = (1 << log) - sum;
  if (left & (left - 1)) throw damaged("Zstandard", "a Huffman tree does not add up");
  weights[n] = 32 - Math.clz32(left);
  const count = n + 1;
  const ranks = new Uint32Array(MAX_LOG + 2);
  for (let s = 0; s < count; s++) ranks[/** @type {number} */ (weights[s])]++;
  let next = 0;
  for (let w = 1; w <= log; w++) {
    const here = /** @type {number} */ (ranks[w]);
    ranks[w] = next;
    next += here << (w - 1);
  }
  const size = 1 << log;
  const symbols = new Uint8Array(size);
  const lengths = new Uint8Array(size);
  for (let s = 0; s < count; s++) {
    const w = /** @type {number} */ (weights[s]);
    if (!w) continue;
    const length = (1 << w) >> 1;
    const at = /** @type {number} */ (ranks[w]);
    symbols.fill(s, at, at + length);
    lengths.fill(log + 1 - w, at, at + length);
    ranks[w] = at + length;
  }
  return { table: { symbols, lengths, log }, bytes };
}

/** Decode `count` literals from one stream at b[start..end) into out at o. */
function stream(
  /** @type {HuffmanTable} */ table,
  /** @type {Uint8Array} */ b,
  /** @type {number} */ start,
  /** @type {number} */ end,
  /** @type {Uint8Array} */ out,
  /** @type {number} */ o,
  /** @type {number} */ count,
) {
  const bits = new BackBits(b, start, end);
  const { symbols, lengths, log } = table;
  for (let i = 0; i < count; i++) {
    const v = bits.peek(log);
    out[o + i] = /** @type {number} */ (symbols[v]);
    bits.pos -= /** @type {number} */ (lengths[v]);
  }
  if (bits.pos !== 0) throw damaged("Zstandard", "a literals stream does not end where it should");
}

/**
 * The literals section at b[at..end) into `lit`.
 * @param {Uint8Array} b @param {number} at @param {number} end @param {Uint8Array} lit
 * @param {LiteralsState} state the frame's last Huffman table, for treeless literals
 * @returns {{ count: number, used: number }}
 */
export function readLiterals(b, at, end, lit, state) {
  if (at >= end) throw damaged("Zstandard", "a block is too short for its literals");
  const b0 = /** @type {number} */ (b[at]);
  const b1 = b[at + 1] ?? 0;
  const b2 = b[at + 2] ?? 0;
  const type = b0 & 3;
  const format = (b0 >> 2) & 3;
  if (type < 2) {
    let size = b0 >> 3;
    let head = 1;
    if (format === 1) {
      size = (b0 >> 4) + (b1 << 4);
      head = 2;
    } else if (format === 3) {
      size = (b0 >> 4) + (b1 << 4) + (b2 << 12);
      head = 3;
    }
    if (size > BLOCK_MAX) throw damaged("Zstandard", "a block has too many literals");
    if (type === 0) {
      if (at + head + size > end) throw damaged("Zstandard", "literals run past their block");
      lit.set(b.subarray(at + head, at + head + size));
      return { count: size, used: head + size };
    }
    if (at + head + 1 > end) throw damaged("Zstandard", "literals run past their block");
    lit.fill(/** @type {number} */ (b[at + head]), 0, size);
    return { count: size, used: head + 1 };
  }
  let regen;
  let comp;
  let head = 3;
  const four = (b0 | (b1 << 8) | (b2 << 16) | ((b[at + 3] ?? 0) << 24)) >>> 0;
  if (format < 2) {
    regen = (four >>> 4) & 0x3ff;
    comp = (four >>> 14) & 0x3ff;
  } else if (format === 2) {
    head = 4;
    regen = (four >>> 4) & 0x3fff;
    comp = (four >>> 18) & 0x3fff;
  } else {
    head = 5;
    regen = (four >>> 4) & 0x3ffff;
    comp = ((four >>> 22) | ((b[at + 4] ?? 0) << 10)) & 0x3ffff;
  }
  if (regen > BLOCK_MAX) throw damaged("Zstandard", "a block has too many literals");
  if (at + head + comp > end) throw damaged("Zstandard", "literals run past their block");
  let p = at + head;
  const stop = p + comp;
  if (type === 2) {
    const { table, bytes } = readHuffman(b, p, stop);
    state.huffman = table;
    p += bytes;
  } else if (!state.huffman)
    throw damaged("Zstandard", "literals reuse a Huffman tree never given");
  const table = state.huffman;
  if (format === 0) {
    stream(table, b, p, stop, lit, 0, regen);
  } else {
    if (p + 6 > stop) throw damaged("Zstandard", "a literals jump table is cut short");
    const s1 = /** @type {number} */ (b[p]) | /** @type {number} */ (b[p + 1] << 8);
    const s2 = /** @type {number} */ (b[p + 2]) | /** @type {number} */ (b[p + 3] << 8);
    const s3 = /** @type {number} */ (b[p + 4]) | /** @type {number} */ (b[p + 5] << 8);
    p += 6;
    const each = (regen + 3) >> 2;
    if (p + s1 + s2 + s3 >= stop || each * 3 > regen)
      throw damaged("Zstandard", "the literals streams do not fit their section");
    stream(table, b, p, p + s1, lit, 0, each);
    stream(table, b, p + s1, p + s1 + s2, lit, each, each);
    stream(table, b, p + s1 + s2, p + s1 + s2 + s3, lit, 2 * each, each);
    stream(table, b, p + s1 + s2 + s3, stop, lit, 3 * each, regen - 3 * each);
  }
  return { count: regen, used: head + comp };
}
