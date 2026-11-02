// The LZMA decoder: literals, matches and repeated matches over a dictionary window. The window grows
// as output arrives until it reaches the dictionary size, then wraps; output leaves it in batches.
import { damaged } from "../input.js";
import { HALF } from "./range.js";

/** @typedef {import("./range.js").RangeDecoder} RangeDecoder */

/** The longest match LZMA writes. */
const MAX_MATCH = 273;

/** The dictionary: the last `size` bytes of output, of which the unflushed ones still to be sent. */
export class Window {
  /** @param {number} size the dictionary size @param {number} [hint] the output size, when known */
  constructor(size, hint) {
    this.size = Math.max(4096, size);
    const start = hint !== undefined && hint >= 0 ? Math.max(hint, 4096) : 1 << 20;
    this.buf = new Uint8Array(Math.min(this.size, start));
    this.pos = 0;
    /** Bytes written since the last dictionary reset. */
    this.total = 0;
    /** `total` at the last flush. */
    this.flushed = 0;
  }

  /** Forget the dictionary (LZMA2's dictionary reset); flush first. */
  reset() {
    this.pos = 0;
    this.total = 0;
    this.flushed = 0;
  }

  /** How many bytes a batch may add before the next flush without overwriting unsent output. */
  room() {
    return Math.max(1, Math.min(1 << 18, this.size - MAX_MATCH));
  }

  /** At the end of the buffer: grow while below the dictionary size, then wrap. */
  turn() {
    if (this.buf.length < this.size) {
      const next = new Uint8Array(Math.min(this.size, this.buf.length * 2));
      next.set(this.buf);
      this.buf = next;
    } else this.pos = 0;
  }

  /** @param {number} byte */
  put(byte) {
    if (this.pos === this.buf.length) this.turn();
    this.buf[this.pos++] = byte;
    this.total++;
  }

  /** @param {Uint8Array} bytes */
  putAll(bytes) {
    for (let i = 0; i < bytes.length; i++) this.put(/** @type {number} */ (bytes[i]));
  }

  /** The byte `distance` back (1 is the last one written). @param {number} distance */
  get(distance) {
    let i = this.pos - distance;
    if (i < 0) i += this.buf.length;
    return /** @type {number} */ (this.buf[i]);
  }

  /** Copy `length` bytes from `distance` back. @param {number} distance @param {number} length */
  copy(distance, length) {
    if (distance > this.total || distance > this.size) throw new RangeError("distance");
    for (let k = 0; k < length; k++) {
      let i = this.pos - distance;
      if (i < 0) i += this.buf.length;
      const byte = /** @type {number} */ (this.buf[i]);
      if (this.pos === this.buf.length) this.turn();
      this.buf[this.pos++] = byte;
    }
    this.total += length;
  }

  /** The bytes written since the last flush, as a fresh copy; undefined when none. */
  flush() {
    const n = this.total - this.flushed;
    if (n <= 0) return undefined;
    const out = new Uint8Array(n);
    const start = this.pos - n;
    if (start >= 0) out.set(this.buf.subarray(start, this.pos));
    else {
      out.set(this.buf.subarray(this.buf.length + start));
      out.set(this.buf.subarray(0, this.pos), -start);
    }
    this.flushed = this.total;
    return out;
  }
}

/** lc, lp and pb from LZMA's properties byte. @param {number} byte @param {string} codec */
export function properties(byte, codec) {
  if (byte >= 225) throw damaged(codec, "the properties are not valid");
  return { lc: byte % 9, lp: Math.floor(byte / 9) % 5, pb: Math.floor(byte / 45) };
}

// Where each group of probabilities starts in one array.
const IS_MATCH = 0;
const IS_REP = 192;
const IS_REP_G0 = 204;
const IS_REP_G1 = 216;
const IS_REP_G2 = 228;
const IS_REP0_LONG = 240;
const POS_SLOT = 432;
const SPEC_POS = 688;
const ALIGN = 803;
const LEN = 819;
const REP_LEN = 1333;
const LITERAL = 1847;

/** What `decode` stopped at. */
export const LIMIT = 0;
export const END = 1;
export const STARVED = 2;

export class LzmaDecoder {
  /** @param {Window} window @param {number} dictSize @param {string} codec */
  constructor(window, dictSize, codec) {
    this.window = window;
    this.dictSize = dictSize;
    this.codec = codec;
    this.probs = new Uint16Array(LITERAL + 0x300);
    this.lc = 0;
    this.lpMask = 0;
    this.pbMask = 0;
    this.state = 0;
    this.rep0 = 0;
    this.rep1 = 0;
    this.rep2 = 0;
    this.rep3 = 0;
    /** What is left of a match a batch's limit cut short. */
    this.rem = 0;
  }

  /** @param {{ lc: number, lp: number, pb: number }} props */
  setProps({ lc, lp, pb }) {
    this.lc = lc;
    this.lpMask = (1 << lp) - 1;
    this.pbMask = (1 << pb) - 1;
    const length = LITERAL + (0x300 << (lc + lp));
    if (this.probs.length !== length) this.probs = new Uint16Array(length);
  }

  /** Probabilities to one half, state and distances to zero. */
  resetState() {
    this.probs.fill(HALF);
    this.state = 0;
    this.rep0 = this.rep1 = this.rep2 = this.rep3 = 0;
    this.rem = 0;
  }

  /** @param {RangeDecoder} rc @param {number} base @param {number} posState */
  length(rc, base, posState) {
    const p = this.probs;
    if (rc.bit(p, base) === 0) return rc.tree(p, base + 2 + posState * 8, 3);
    if (rc.bit(p, base + 1) === 0) return 8 + rc.tree(p, base + 130 + posState * 8, 3);
    return 16 + rc.tree(p, base + 258, 8);
  }

  /** @param {RangeDecoder} rc @param {number} length */
  distance(rc, length) {
    const p = this.probs;
    const slot = rc.tree(p, POS_SLOT + Math.min(length, 3) * 64, 6);
    if (slot < 4) return slot;
    const bits = (slot >>> 1) - 1;
    let distance = (2 | (slot & 1)) * 2 ** bits;
    if (slot < 14) return distance + rc.reverse(p, SPEC_POS + distance - slot, bits);
    distance += rc.direct(bits - 4) * 16;
    return distance + rc.reverse(p, ALIGN, 4);
  }

  /**
   * Decode until `limit` bytes have been written since the dictionary reset, the end marker, or (with
   * `margin`) until fewer than `margin` input bytes stay buffered while more may come.
   * @param {RangeDecoder} rc @param {number} limit @param {number} margin
   */
  decode(rc, limit, margin) {
    const w = this.window;
    const p = this.probs;
    const input = rc.input;
    if (this.rem > 0) {
      const n = Math.min(this.rem, limit - w.total);
      w.copy(this.rep0 + 1, n);
      this.rem -= n;
    }
    while (w.total < limit) {
      if (margin && !input.done && input.buf.length - input.pos < margin) return STARVED;
      const posState = w.total & this.pbMask;
      const state = this.state;
      if (rc.bit(p, IS_MATCH + (state << 4) + posState) === 0) {
        const previous = w.total > 0 ? w.get(1) : 0;
        const lit =
          LITERAL + 0x300 * (((w.total & this.lpMask) << this.lc) + (previous >>> (8 - this.lc)));
        let symbol = 1;
        if (state >= 7) {
          let match = w.get(this.rep0 + 1);
          do {
            const matchBit = (match >>> 7) & 1;
            match <<= 1;
            const bit = rc.bit(p, lit + ((1 + matchBit) << 8) + symbol);
            symbol = (symbol << 1) | bit;
            if (matchBit !== bit) break;
          } while (symbol < 0x100);
        }
        while (symbol < 0x100) symbol = (symbol << 1) | rc.bit(p, lit + symbol);
        w.put(symbol - 0x100);
        this.state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
        continue;
      }
      let length = 0;
      if (rc.bit(p, IS_REP + state)) {
        if (w.total === 0) throw damaged(this.codec, "a repeated match comes first");
        if (rc.bit(p, IS_REP_G0 + state) === 0) {
          if (rc.bit(p, IS_REP0_LONG + (state << 4) + posState) === 0) {
            this.state = state < 7 ? 9 : 11;
            w.put(w.get(this.rep0 + 1));
            continue;
          }
        } else {
          let distance = 0;
          if (rc.bit(p, IS_REP_G1 + state) === 0) distance = this.rep1;
          else {
            if (rc.bit(p, IS_REP_G2 + state) === 0) distance = this.rep2;
            else {
              distance = this.rep3;
              this.rep3 = this.rep2;
            }
            this.rep2 = this.rep1;
          }
          this.rep1 = this.rep0;
          this.rep0 = distance;
        }
        length = this.length(rc, REP_LEN, posState);
        this.state = state < 7 ? 8 : 11;
      } else {
        this.rep3 = this.rep2;
        this.rep2 = this.rep1;
        this.rep1 = this.rep0;
        length = this.length(rc, LEN, posState);
        this.state = state < 7 ? 7 : 10;
        this.rep0 = this.distance(rc, length);
        if (this.rep0 === 0xffffffff) {
          if (rc.code === 0) return END;
          throw damaged(this.codec, "the end marker is not valid");
        }
        if (this.rep0 >= this.dictSize || this.rep0 >= w.total)
          throw damaged(this.codec, "a match reaches back before the data");
      }
      length += 2;
      const n = Math.min(length, limit - w.total);
      w.copy(this.rep0 + 1, n);
      this.rem = length - n;
    }
    return LIMIT;
  }
}
