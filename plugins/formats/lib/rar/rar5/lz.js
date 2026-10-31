// RAR 5's LZ + Huffman method, after libarchive's BSD-licensed RAR 5 reader: blocks with a header
// and an optional set of tables, literals, matches with a distance cache, and filters. The window
// is a ring; it is flushed through the filters into the entry's sink as it fills.
import { DAMAGED } from "../entries.js";
import { Huffman } from "../huffman.js";
import { emit } from "../ring.js";
import { run } from "./filters.js";

/** @typedef {import("../input.js").Input} Input */
/** @typedef {import("../sink.js").Sink} Sink */
/** @typedef {import("../pace.js").Pace} Pace */
/** @typedef {import("./filters.js").Filter} Filter */

const NC = 306;
const DC = 64;
const LDC = 16;
const RC = 44;
const BC = 20;
const TABLES = NC + DC + LDC + RC;
/** Room kept free in the ring beyond the unflushed bytes: more than one match can add. */
const MARGIN = 0x10000;
const SLICE = 1 << 18;
const MOST_FILTERS = 8192;

/** A match length from its slot and extra bits. @param {Input} input @param {number} slot */
function slotLength(input, slot) {
  if (slot < 8) return slot + 2;
  const bits = (slot >>> 2) - 1;
  return 2 + ((4 | (slot & 3)) << bits) + input.bits(bits);
}

export class Decoder5 {
  /** @param {number} size the ring's size, a power of two */
  constructor(size) {
    this.win = new Uint8Array(size);
    this.mask = size - 1;
    /** Bytes decoded in the stream, and how many of them went to the sink. */
    this.pos = 0;
    this.flushed = 0;
    this.main = new Huffman(NC, 10);
    this.dist = new Huffman(DC, 7);
    this.low = new Huffman(LDC, 7);
    this.len = new Huffman(RC, 7);
    this.codes = new Huffman(BC, 7);
    this.lengths = new Uint8Array(TABLES);
    this.tables = false;
    this.reps = [0, 0, 0, 0];
    this.last = 0;
    /** @type {Filter[]} */
    this.filters = [];
    this.fileStart = 0;
  }

  /**
   * Decodes one file's packed data into `sink`; with `solid` the state of the files before it stays.
   * @param {Input} input @param {Sink} sink @param {Pace} pace
   */
  async file(input, sink, pace) {
    this.fileStart = this.pos;
    this.filters = [];
    if (sink.size === 0 && input.length === 0) return;
    for (let last = false; !last; ) {
      await input.ensure(8);
      if (input.left <= 0) throw new Error(DAMAGED);
      const flags = input.byte();
      const check = input.byte();
      const count = ((flags >> 3) & 7) + 1;
      if (count > 3) throw new Error(DAMAGED);
      let size = 0;
      for (let i = 0; i < count; i++) size += input.byte() * 256 ** i;
      if ((0x5a ^ flags ^ (size & 0xff) ^ ((size >> 8) & 0xff) ^ (size >> 16)) !== check)
        throw new Error(DAMAGED);
      await input.ensure(size);
      if (size > input.ready) throw new Error(DAMAGED);
      const begin = input.pos;
      const end = begin + (size - 1) * 8 + (flags & 7) + 1;
      if (flags & 0x80) this.readTables(input, end);
      else if (!this.tables) throw new Error(DAMAGED);
      while (input.pos < end) {
        const room = this.win.length - MARGIN - (this.pos - this.flushed);
        if (room <= 0) throw new Error(DAMAGED);
        this.decode(input, end, Math.min(room, SLICE));
        this.flush(sink);
        if (sink.done) return;
        await pace.step();
      }
      input.pos = begin + size * 8;
      last = (flags & 0x40) !== 0;
    }
    this.flush(sink);
    if (this.flushed !== this.pos) throw new Error(DAMAGED);
  }

  /** The bit-length code, then the lengths of all four codes. @param {Input} input @param {number} end */
  readTables(input, end) {
    const bits = new Uint8Array(BC);
    for (let i = 0; i < BC; ) {
      const n = input.bits(4);
      if (n !== 15) bits[i++] = n;
      else {
        const zeros = input.bits(4);
        if (zeros === 0) bits[i++] = 15;
        else for (let k = 0; k < zeros + 2 && i < BC; k++) bits[i++] = 0;
      }
    }
    this.codes.build(bits, 0);
    const t = this.lengths;
    for (let i = 0; i < TABLES; ) {
      if (input.pos > end) throw new Error(DAMAGED);
      const n = this.codes.decode(input);
      if (n < 16) t[i++] = n;
      else if (n < 18) {
        if (i === 0) throw new Error(DAMAGED);
        const count = n === 16 ? input.bits(3) + 3 : input.bits(7) + 11;
        for (let k = 0; k < count && i < TABLES; k++, i++) t[i] = /** @type {number} */ (t[i - 1]);
      } else {
        const count = n === 18 ? input.bits(3) + 3 : input.bits(7) + 11;
        for (let k = 0; k < count && i < TABLES; k++) t[i++] = 0;
      }
    }
    if (input.pos > end) throw new Error(DAMAGED);
    this.main.build(t, 0);
    this.dist.build(t, NC);
    this.low.build(t, NC + DC);
    this.len.build(t, NC + DC + LDC);
    this.tables = true;
  }

  /** Decodes symbols until the block's end or `budget` more bytes. @param {Input} input @param {number} end @param {number} budget */
  decode(input, end, budget) {
    const { win, mask, main, dist, low, len, reps } = this;
    const start = this.pos;
    let w = start % win.length;
    let made = 0;
    while (input.pos < end && made < budget) {
      const sym = main.decode(input);
      if (sym < 256) {
        win[w] = sym;
        w = (w + 1) & mask;
        made++;
        continue;
      }
      let length = 0;
      let distance = 0;
      if (sym >= 262) {
        length = slotLength(input, sym - 262);
        const slot = dist.decode(input);
        if (slot < 4) distance = slot + 1;
        else {
          const bits = (slot >>> 1) - 1;
          distance = (2 | (slot & 1)) * 2 ** bits + 1;
          if (bits >= 4) {
            if (bits > 4) distance += input.long(bits - 4) * 16;
            distance += low.decode(input);
          } else distance += input.bits(bits);
        }
        if (distance > 0x100) length += distance > 0x40000 ? 3 : distance > 0x2000 ? 2 : 1;
        reps[3] = /** @type {number} */ (reps[2]);
        reps[2] = /** @type {number} */ (reps[1]);
        reps[1] = /** @type {number} */ (reps[0]);
        reps[0] = distance;
        this.last = length;
      } else if (sym === 256) {
        this.pos = start + made;
        this.readFilter(input);
        continue;
      } else if (sym === 257) {
        if (this.last === 0) continue;
        length = this.last;
        distance = /** @type {number} */ (reps[0]);
      } else {
        const index = sym - 258;
        distance = /** @type {number} */ (reps[index]);
        for (let i = index; i > 0; i--) reps[i] = /** @type {number} */ (reps[i - 1]);
        reps[0] = distance;
        length = slotLength(input, len.decode(input));
        this.last = length;
      }
      if (distance > start + made || distance > win.length) throw new Error(DAMAGED);
      let from = (w - distance) & mask;
      for (let i = 0; i < length; i++) {
        win[w] = /** @type {number} */ (win[from]);
        w = (w + 1) & mask;
        from = (from + 1) & mask;
      }
      made += length;
    }
    this.pos = start + made;
  }

  /** A filter: where its block starts, how long it is, its type. @param {Input} input */
  readFilter(input) {
    const number = () => {
      const count = input.bits(2) + 1;
      let value = 0;
      for (let i = 0; i < count; i++) value += input.bits(8) * 256 ** i;
      return value;
    };
    const start = this.pos + number();
    const length = number();
    const type = input.bits(3);
    const channels = type === 0 ? input.bits(5) + 1 : 0;
    const previous = this.filters.at(-1);
    if (length < 4 || length > 0x400000 || type > 3 || this.filters.length >= MOST_FILTERS)
      throw new Error(DAMAGED);
    if (previous && start < previous.start + previous.length) throw new Error(DAMAGED);
    this.filters.push({ start, length, type, channels, offset: start - this.fileStart });
  }

  /** Sends what is decoded to the sink, running each filter once its block is complete. @param {Sink} sink */
  flush(sink) {
    for (;;) {
      const filter = this.filters[0];
      if (filter && filter.start + filter.length <= this.pos) {
        if (filter.start < this.flushed) throw new Error(DAMAGED);
        this.emit(sink, filter.start);
        sink.write(run(filter, this.win));
        this.flushed = filter.start + filter.length;
        this.filters.shift();
        continue;
      }
      this.emit(sink, filter ? Math.min(filter.start, this.pos) : this.pos);
      return;
    }
  }

  /** Sends the ring's bytes up to stream position `to`. @param {Sink} sink @param {number} to */
  emit(sink, to) {
    if (to <= this.flushed) return;
    emit(this.win, this.flushed, to, sink);
    this.flushed = to;
  }
}
