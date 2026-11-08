// bzip2: blocks of Huffman-coded MTF symbols over a Burrows-Wheeler transform, with run-length
// coding on both sides and a CRC per block and per stream. Each block is read whole (it has no
// length), decoded, and its output yielded in parts; streams written back to back (pbzip2) follow.
import { crcBzip2 } from "../checksums.js";
import { damaged, endsEarly } from "../input.js";
import { huffman } from "./huffman.js";

/** @typedef {import("../input.js").Input} Input */

const CODEC = "bzip2";
/** The most a block's bits can take: 900k symbols at 20 bits, and the tables. */
const BLOCK_BYTES = 2_400_000;
const OUT = 256 * 1024;

/** Bits read most significant first, straight from the input's buffer. */
class Bits {
  /** @param {Input} input */
  constructor(input) {
    this.input = input;
    this.buf = 0;
    this.count = 0;
  }
  /** Up to 24 bits. @param {number} n */
  get(n) {
    const input = this.input;
    while (this.count < n) {
      if (input.pos >= input.buf.length) throw endsEarly(CODEC);
      this.buf = ((this.buf << 8) | /** @type {number} */ (input.buf[input.pos++])) >>> 0;
      this.count += 8;
    }
    this.count -= n;
    return (this.buf >>> this.count) & ((1 << n) - 1);
  }
  bit() {
    return this.get(1);
  }
  /** 32 bits as an unsigned number. */
  u32() {
    return ((this.get(16) << 16) | this.get(16)) >>> 0;
  }
  /** Peek up to 24 bits without moving; zeros past the end. @param {number} n */
  peek(n) {
    const input = this.input;
    while (this.count < n) {
      const b = input.pos < input.buf.length ? /** @type {number} */ (input.buf[input.pos]) : 0;
      if (input.pos < input.buf.length) input.pos++;
      else this.padding = (this.padding ?? 0) + 8;
      this.buf = ((this.buf << 8) | b) >>> 0;
      this.count += 8;
    }
    return (this.buf >>> (this.count - n)) & ((1 << n) - 1);
  }
  /** @param {number} n */
  skip(n) {
    if (n > this.count - (this.padding ?? 0)) throw endsEarly(CODEC);
    this.count -= n;
  }
  /** Drop the bits up to the next byte. */
  align() {
    this.count -= this.count % 8;
  }
}

/**
 * One block's symbols, undone back to the BWT's last column `ll` (its length returned).
 * @param {Bits} bits @param {Uint8Array} ll @param {number} max
 */
function readSymbols(bits, ll, max) {
  // Which byte values the block uses.
  const used = bits.get(16);
  /** @type {number[]} */
  const seqToUnseq = [];
  for (let i = 0; i < 16; i++) {
    if (!(used & (0x8000 >> i))) continue;
    const row = bits.get(16);
    for (let j = 0; j < 16; j++) if (row & (0x8000 >> j)) seqToUnseq.push(i * 16 + j);
  }
  if (seqToUnseq.length === 0) throw damaged(CODEC, "a block uses no byte values");
  const alpha = seqToUnseq.length + 2;
  const groups = bits.get(3);
  const selectorCount = bits.get(15);
  if (groups < 2 || groups > 6 || selectorCount < 1)
    throw damaged(CODEC, "a block's tables are out of range");
  // Selectors, move-to-front coded in unary.
  const order = [0, 1, 2, 3, 4, 5].slice(0, groups);
  const selectors = new Uint8Array(selectorCount);
  for (let i = 0; i < selectorCount; i++) {
    let j = 0;
    while (bits.bit()) if (++j >= groups) throw damaged(CODEC, "a selector is out of range");
    const v = /** @type {number} */ (order[j]);
    order.splice(j, 1);
    order.unshift(v);
    selectors[i] = v;
  }
  // Code lengths, delta coded, for each group's table.
  const tables = [];
  for (let t = 0; t < groups; t++) {
    const lengths = new Uint8Array(alpha);
    let length = bits.get(5);
    for (let i = 0; i < alpha; i++) {
      for (;;) {
        if (length < 1 || length > 20) throw damaged(CODEC, "a code length is out of range");
        if (!bits.bit()) break;
        length += bits.bit() ? -1 : 1;
      }
      lengths[i] = length;
    }
    tables.push(huffman(lengths));
  }
  // The symbols: RUNA/RUNB runs of the front byte, MTF positions, end of block.
  const mtf = Uint8Array.from(seqToUnseq.keys());
  const eob = alpha - 1;
  let n = 0;
  let run = 0;
  let weight = 1;
  for (let group = 0, left = 0, table = tables[0]; ; left--) {
    if (left === 0) {
      if (group >= selectorCount) throw damaged(CODEC, "a block has more groups than selectors");
      table = tables[/** @type {number} */ (selectors[group++])];
      left = 50;
    }
    const sym = /** @type {ReturnType<typeof huffman>} */ (table).decode(bits);
    if (sym <= 1) {
      run += weight << sym;
      weight <<= 1;
      if (run > max) throw damaged(CODEC, "a run is longer than the block");
      continue;
    }
    if (run) {
      if (n + run > max) throw damaged(CODEC, "a block is longer than its size");
      ll.fill(/** @type {number} */ (seqToUnseq[/** @type {number} */ (mtf[0])]), n, n + run);
      n += run;
      run = 0;
      weight = 1;
    }
    if (sym === eob) break;
    if (n >= max) throw damaged(CODEC, "a block is longer than its size");
    const pos = sym - 1;
    const v = /** @type {number} */ (mtf[pos]);
    mtf.copyWithin(1, 0, pos);
    mtf[0] = v;
    ll[n++] = /** @type {number} */ (seqToUnseq[v]);
  }
  return n;
}

/**
 * The block's output: the inverse BWT walked from `origin`, then the first run-length coding
 * undone, in parts of at most OUT bytes. Returns the block's CRC with the last part.
 * @param {Uint8Array} ll @param {number} n @param {number} origin @param {Uint32Array} tt
 */
function* unblock(ll, n, origin, tt) {
  if (origin >= n) throw damaged(CODEC, "a block's origin is outside it");
  const counts = new Uint32Array(256);
  for (let i = 0; i < n; i++) counts[/** @type {number} */ (ll[i])]++;
  for (let b = 0, sum = 0; b < 256; b++) {
    const c = /** @type {number} */ (counts[b]);
    counts[b] = sum;
    sum += c;
  }
  for (let i = 0; i < n; i++) {
    const b = /** @type {number} */ (ll[i]);
    tt[/** @type {number} */ (counts[b])++] = i;
  }
  let crc = ~0;
  let out = new Uint8Array(OUT);
  let o = 0;
  let pos = /** @type {number} */ (tt[origin]);
  let last = -1;
  let same = 0;
  for (let i = 0; i < n; i++) {
    const b = /** @type {number} */ (ll[pos]);
    pos = /** @type {number} */ (tt[pos]);
    if (same === 4) {
      // The fifth byte after four equal ones is how many more there are.
      for (let k = 0; k < b; k++) {
        if (o === OUT) {
          crc = crcBzip2(out, o, crc);
          yield out;
          out = new Uint8Array(OUT);
          o = 0;
        }
        out[o++] = last;
      }
      same = 0;
      last = -1;
      continue;
    }
    same = b === last ? same + 1 : 1;
    last = b;
    if (o === OUT) {
      crc = crcBzip2(out, o, crc);
      yield out;
      out = new Uint8Array(OUT);
      o = 0;
    }
    out[o++] = b;
  }
  crc = crcBzip2(out, o, crc);
  if (o) yield out.subarray(0, o);
  return ~crc >>> 0;
}

/** @param {Input} input @returns {AsyncGenerator<Uint8Array>} */
export async function* bunzip2(input) {
  input.ends = () => endsEarly(CODEC);
  for (let streams = 0; ; streams++) {
    if (!(await input.need(4))) {
      if (streams === 0) throw endsEarly(CODEC);
      return;
    }
    const head = input.buf.subarray(input.pos, input.pos + 4);
    if (head[0] !== 0x42 || head[1] !== 0x5a || head[2] !== 0x68) {
      if (streams > 0 && head.every((b) => b === 0)) return;
      if (streams > 0) throw damaged(CODEC, "unknown data follows the stream");
      throw damaged(CODEC, "it does not start with BZh");
    }
    const level = (head[3] ?? 0) - 0x30;
    if (level < 1 || level > 9) throw damaged(CODEC, "the block size is out of range");
    input.pos += 4;
    const max = level * 100_000;
    const ll = new Uint8Array(max);
    const tt = new Uint32Array(max);
    const bits = new Bits(input);
    let combined = 0;
    for (;;) {
      // A block has no length: keep enough buffered for the largest one.
      await input.need(BLOCK_BYTES);
      const magic = bits.get(24) * 0x1000000 + bits.get(24);
      const stored = bits.u32();
      if (magic === 0x177245385090) {
        if (stored !== combined >>> 0) throw damaged(CODEC, "the stream's CRC does not match");
        // Whole bytes already taken into the bit buffer belong to what follows.
        bits.align();
        input.pos -= Math.min(input.pos, bits.count >> 3);
        bits.count = 0;
        break;
      }
      if (magic !== 0x314159265359) throw damaged(CODEC, "a block header is missing");
      if (bits.bit()) throw damaged(CODEC, "randomised blocks are not supported");
      const origin = bits.get(24);
      const n = readSymbols(bits, ll, max);
      const blocks = unblock(ll, n, origin, tt);
      let step = blocks.next();
      while (!step.done) {
        yield step.value.slice();
        step = blocks.next();
      }
      if (step.value !== stored) throw damaged(CODEC, "a block's CRC does not match");
      combined = (((combined << 1) | (combined >>> 31)) ^ stored) >>> 0;
    }
  }
}
