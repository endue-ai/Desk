// RAR 2.9's method (RAR 3 and 4), after libarchive's BSD-licensed RAR reader: LZSS with Huffman
// codes whose lengths are sent as differences from the last table, PPMd variant H blocks, and VM
// filters. In a solid archive the window, the codes, the model and the filters carry on.
import { DAMAGED } from "../entries.js";
import { Huffman } from "../huffman.js";
import { emit, unwrap } from "../ring.js";
import { execute, Filters4 } from "./filters.js";
import { PpmdModel } from "./ppmd.js";
import { RangeDecoder } from "./ppmd-range.js";

/** @typedef {import("../input.js").Input} Input */
/** @typedef {import("../sink.js").Sink} Sink */
/** @typedef {import("../pace.js").Pace} Pace */

const NC = 299;
const DC = 60;
const LDC = 17;
const RC = 28;
const TABLES = NC + DC + LDC + RC;
const LENGTH_BASE = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160,
  192, 224,
];
const LENGTH_BITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5,
];
const DIST_BITS = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
  14, 14, 15, 15, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 18, 18, 18, 18, 18, 18,
  18, 18, 18, 18, 18, 18,
];
const DIST_BASE = DIST_BITS.map((_, i, bits) => bits.slice(0, i).reduce((n, b) => n + 2 ** b, 0));
const SHORT_BASE = [0, 4, 8, 16, 32, 64, 128, 192];
const SHORT_BITS = [2, 2, 3, 4, 5, 6, 6, 6];
const MARGIN = 0x10000;
const SLICE = 1 << 16;
/** PPMd decodes a few times slower than LZ: smaller slices keep the turns frequent. */
const PPM_SLICE = 1 << 14;
/** Packed bytes kept loaded ahead of decoding: more than a table, a filter or a PPMd step reads. */
const AHEAD = 1 << 18;
/** Loaded bytes a step may read past the stopping point: the longest filter definition. */
const KEEP = 0x12000;

export class Decoder4 {
  /** @param {number} size the ring's size, a power of two */
  constructor(size) {
    this.win = new Uint8Array(size);
    this.mask = size - 1;
    this.pos = 0;
    this.flushed = 0;
    this.main = new Huffman(NC, 10);
    this.dist = new Huffman(DC, 7);
    this.low = new Huffman(LDC, 7);
    this.len = new Huffman(RC, 7);
    this.codes = new Huffman(20, 7);
    this.lengths = new Uint8Array(TABLES);
    this.tables = false;
    this.newTables = true;
    this.ppm = false;
    /** @type {PpmdModel | undefined} */
    this.model = undefined;
    /** @type {RangeDecoder | undefined} */
    this.range = undefined;
    this.escape = 2;
    this.old = [0, 0, 0, 0];
    this.lastDist = 0;
    this.lastLength = 0;
    this.lowRepeats = 0;
    this.lastLow = 0;
    this.filters = new Filters4();
    this.fileStart = 0;
    /** Set when the stream marks the end of the file. */
    this.ended = false;
  }

  /** Decodes one file's packed data into `sink`. @param {Input} input @param {Sink} sink @param {Pace} pace */
  async file(input, sink, pace) {
    this.fileStart = this.pos;
    this.ended = false;
    const end = this.pos + sink.size;
    if (sink.size === 0 && input.length === 0) return;
    await input.ensure(AHEAD);
    if (!this.tables || this.newTables || this.ppm) this.readTables(input);
    while (this.pos < end) {
      await input.ensure(AHEAD);
      const room = this.win.length - MARGIN - (this.pos - this.flushed);
      if (room <= 0 || this.ended || (input.over && input.left <= 0)) throw new Error(DAMAGED);
      const safe =
        input.length - input.base > input.filled
          ? (input.filled - KEEP) * 8
          : Number.POSITIVE_INFINITY;
      this.decode(
        input,
        Math.min(end, this.pos + Math.min(room, this.ppm ? PPM_SLICE : SLICE)),
        safe,
      );
      if (input.pos > (input.length - input.base) * 8 + 64) throw new Error(DAMAGED);
      this.flush(sink);
      if (sink.done) return;
      await pace.step();
    }
    if (this.pos !== end) throw new Error(DAMAGED);
    this.flush(sink);
    if (this.flushed !== this.pos) throw new Error(DAMAGED);
    this.marker(input);
  }

  /** After a file's last byte: the end-of-file mark, which says whether new tables follow. @param {Input} input */
  marker(input) {
    this.newTables = true;
    if (this.ended || input.left <= 0) return;
    if (this.ppm) {
      if (this.model?.decode(/** @type {RangeDecoder} */ (this.range)) === this.escape) {
        const code = this.model?.decode(/** @type {RangeDecoder} */ (this.range));
        if (code === 2) this.newTables = false;
      }
      return;
    }
    if (this.main.decode(input) === 256 && input.bits(1) === 0)
      this.newTables = input.bits(1) === 1;
  }

  /** A table block: PPMd parameters, or the Huffman code lengths. @param {Input} input */
  readTables(input) {
    input.align();
    if (input.bits(1)) {
      const flags = input.bits(7);
      const memory = flags & 0x20 ? (input.byte() + 1) << 20 : 0;
      if (flags & 0x40) this.escape = input.byte();
      if (flags & 0x20) {
        let order = (flags & 0x1f) + 1;
        if (order > 16) order = 16 + (order - 16) * 3;
        if (order === 1) throw new Error(DAMAGED);
        this.model ??= new PpmdModel();
        this.model.restart(memory, order);
      } else if (!this.model) throw new Error(DAMAGED);
      this.range = new RangeDecoder({ byte: () => input.byte() });
      if (!this.range.init()) throw new Error(DAMAGED);
      this.ppm = true;
      this.tables = true;
      return;
    }
    this.ppm = false;
    const t = this.lengths;
    if (!input.bits(1)) t.fill(0);
    const bits = new Uint8Array(20);
    for (let i = 0; i < 20; ) {
      const n = input.bits(4);
      if (n !== 15) bits[i++] = n;
      else {
        const zeros = input.bits(4);
        if (zeros === 0) bits[i++] = 15;
        else for (let k = 0; k < zeros + 2 && i < 20; k++) bits[i++] = 0;
      }
    }
    this.codes.build(bits, 0);
    for (let i = 0; i < TABLES; ) {
      const n = this.codes.decode(input);
      if (n < 16) {
        t[i] = /** @type {number} */ (t[i] + n) & 15;
        i++;
      } else if (n < 18) {
        if (i === 0) throw new Error(DAMAGED);
        const count = n === 16 ? input.bits(3) + 3 : input.bits(7) + 11;
        for (let k = 0; k < count && i < TABLES; k++, i++) t[i] = /** @type {number} */ (t[i - 1]);
      } else {
        const count = n === 18 ? input.bits(3) + 3 : input.bits(7) + 11;
        for (let k = 0; k < count && i < TABLES; k++) t[i++] = 0;
      }
    }
    if (input.over) throw new Error(DAMAGED);
    this.main.build(t, 0);
    this.dist.build(t, NC);
    this.low.build(t, NC + DC);
    this.len.build(t, NC + DC + LDC);
    this.tables = true;
  }

  /** Decodes until stream position `stop` or input bit `safe`. @param {Input} input @param {number} stop @param {number} safe */
  decode(input, stop, safe) {
    while (this.pos < stop && input.pos < safe && !this.ended) {
      if (this.ppm) this.decodePpm(input, stop, safe);
      else this.decodeLz(input, stop, safe);
    }
  }

  /** LZ symbols. @param {Input} input @param {number} stop @param {number} safe */
  decodeLz(input, stop, safe) {
    const { main, dist, low, len, old } = this;
    while (this.pos < stop && input.pos < safe) {
      const sym = main.decode(input);
      if (sym < 256) {
        this.win[this.pos % this.win.length] = sym;
        this.pos++;
        continue;
      }
      let length = 0;
      let distance = 0;
      if (sym === 256) {
        if (input.bits(1)) {
          this.readTables(input);
          return;
        }
        this.newTables = input.bits(1) === 1;
        this.ended = true;
        return;
      }
      if (sym === 257) {
        this.readFilter(() => input.byte());
        continue;
      }
      if (sym === 258) {
        if (this.lastLength === 0) continue;
        distance = this.lastDist;
        length = this.lastLength;
      } else if (sym <= 262) {
        const index = sym - 259;
        distance = /** @type {number} */ (old[index]);
        const slot = len.decode(input);
        if (slot >= RC) throw new Error(DAMAGED);
        length =
          /** @type {number} */ (LENGTH_BASE[slot]) +
          2 +
          input.bits(/** @type {number} */ (LENGTH_BITS[slot]));
        for (let i = index; i > 0; i--) old[i] = /** @type {number} */ (old[i - 1]);
        old[0] = distance;
      } else if (sym <= 270) {
        const s = sym - 263;
        distance =
          /** @type {number} */ (SHORT_BASE[s]) +
          1 +
          input.bits(/** @type {number} */ (SHORT_BITS[s]));
        length = 2;
        old.unshift(distance);
        old.length = 4;
      } else {
        const s = sym - 271;
        if (s >= RC) throw new Error(DAMAGED);
        length =
          /** @type {number} */ (LENGTH_BASE[s]) +
          3 +
          input.bits(/** @type {number} */ (LENGTH_BITS[s]));
        const slot = dist.decode(input);
        if (slot >= DC) throw new Error(DAMAGED);
        distance = /** @type {number} */ (DIST_BASE[slot]) + 1;
        const bits = /** @type {number} */ (DIST_BITS[slot]);
        if (bits > 0 && slot > 9) {
          if (bits > 4) distance += input.bits(bits - 4) << 4;
          if (this.lowRepeats > 0) {
            this.lowRepeats--;
            distance += this.lastLow;
          } else {
            const l = low.decode(input);
            if (l === 16) {
              this.lowRepeats = 15;
              distance += this.lastLow;
            } else {
              distance += l;
              this.lastLow = l;
            }
          }
        } else if (bits > 0) distance += input.bits(bits);
        if (distance >= 0x40000) length++;
        if (distance >= 0x2000) length++;
        old.unshift(distance);
        old.length = 4;
      }
      this.lastDist = distance;
      this.lastLength = length;
      this.copy(distance, length);
    }
  }

  /** PPMd symbols, and the escapes for matches, filters, new tables and the file's end. @param {Input} input @param {number} stop @param {number} safe */
  decodePpm(input, stop, safe) {
    const model = /** @type {PpmdModel} */ (this.model);
    const range = /** @type {RangeDecoder} */ (this.range);
    const next = () => {
      const sym = model.decode(range);
      if (sym < 0) throw new Error(DAMAGED);
      return sym;
    };
    while (this.pos < stop && input.pos < safe) {
      const sym = next();
      if (sym !== this.escape) {
        this.win[this.pos % this.win.length] = sym;
        this.pos++;
        continue;
      }
      const code = next();
      if (code === 0) {
        this.readTables(input);
        return;
      }
      if (code === 2) {
        this.ended = true;
        this.newTables = false;
        return;
      }
      if (code === 3) this.readFilter(next);
      else if (code === 4) {
        const distance = ((next() << 16) | (next() << 8) | next()) + 2;
        this.copy(distance, next() + 32);
      } else if (code === 5) this.copy(1, next() + 4);
      else {
        this.win[this.pos % this.win.length] = sym;
        this.pos++;
      }
    }
  }

  /** Copies `length` bytes from `distance` back. @param {number} distance @param {number} length */
  copy(distance, length) {
    const win = this.win;
    const size = win.length;
    if (distance > this.pos || distance > size) throw new Error(DAMAGED);
    let to = this.pos % size;
    let from = (to - distance + size) % size;
    for (let i = 0; i < length; i++) {
      win[to] = /** @type {number} */ (win[from]);
      to = to + 1 === size ? 0 : to + 1;
      from = from + 1 === size ? 0 : from + 1;
    }
    this.pos += length;
  }

  /** A filter definition: its flags, its length, its bytes. @param {() => number} next */
  readFilter(next) {
    const flags = next();
    let length = (flags & 7) + 1;
    if (length === 7) length = next() + 7;
    else if (length === 8) length = (next() << 8) | next();
    const code = new Uint8Array(length);
    for (let i = 0; i < length; i++) code[i] = next();
    this.filters.define(code, flags, this.pos, this.win.length - MARGIN);
  }

  /** Sends what is decoded to the sink, running filters once their blocks are complete. @param {Sink} sink */
  flush(sink) {
    const stack = this.filters.stack;
    for (;;) {
      const filter = stack[0];
      if (filter && filter.start + filter.length <= this.pos) {
        if (filter.start < this.flushed) throw new Error(DAMAGED);
        this.emit(sink, filter.start);
        let out = execute(
          filter,
          unwrap(this.win, filter.start, filter.length),
          filter.start - this.fileStart,
        );
        stack.shift();
        for (
          let f = stack[0];
          f && f.start === filter.start && f.length === out.length;
          f = stack[0]
        ) {
          out = execute(f, out, f.start - this.fileStart);
          stack.shift();
        }
        sink.write(out);
        this.flushed = filter.start + filter.length;
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
