// LZMA's range decoder: 11-bit probabilities, bit trees, and a byte pulled in at each
// normalisation. It reads straight from an Input's buffer; the caller keeps enough of it buffered.
import { damaged } from "../input.js";

/** @typedef {import("../input.js").Input} Input */

/** Every probability starts at one half. */
export const HALF = 1024;

export class RangeDecoder {
  /** @param {Input} input */
  constructor(input) {
    this.input = input;
    this.range = 0;
    this.code = 0;
  }

  /** Start a coded run: a zero byte, then four bytes of code. @param {string} codec */
  init(codec) {
    if (this.next() !== 0) throw damaged(codec, "the range coder does not start with zero");
    this.range = 0xffffffff;
    this.code = 0;
    for (let i = 0; i < 4; i++) this.code = this.code * 256 + this.next();
    if (this.code >= this.range) throw damaged(codec, "the range coder starts out of range");
  }

  /** The next input byte; throws the input's "ends" error past the end. */
  next() {
    const input = this.input;
    if (input.pos >= input.buf.length) throw input.ends();
    return /** @type {number} */ (input.buf[input.pos++]);
  }

  /** One bit under the probability at `probs[at]`, which it then adapts. @param {Uint16Array} probs @param {number} at */
  bit(probs, at) {
    const p = /** @type {number} */ (probs[at]);
    const bound = (this.range >>> 11) * p;
    let bit = 0;
    if (this.code < bound) {
      this.range = bound;
      probs[at] = p + ((2048 - p) >>> 5);
    } else {
      this.range -= bound;
      this.code -= bound;
      probs[at] = p - (p >>> 5);
      bit = 1;
    }
    if (this.range < 0x1000000) {
      this.range *= 256;
      this.code = this.code * 256 + this.next();
    }
    return bit;
  }

  /** `count` bits at probability one half, most significant first. @param {number} count */
  direct(count) {
    let result = 0;
    for (let i = 0; i < count; i++) {
      this.range = Math.floor(this.range / 2);
      let bit = 0;
      if (this.code >= this.range) {
        this.code -= this.range;
        bit = 1;
      }
      result = result * 2 + bit;
      if (this.range < 0x1000000) {
        this.range *= 256;
        this.code = this.code * 256 + this.next();
      }
    }
    return result;
  }

  /** A `bits`-bit symbol from the tree at `probs[at + 1 ...]`. @param {Uint16Array} probs @param {number} at @param {number} bits */
  tree(probs, at, bits) {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) + this.bit(probs, at + m);
    return m - (1 << bits);
  }

  /** The same, least significant bit first. @param {Uint16Array} probs @param {number} at @param {number} bits */
  reverse(probs, at, bits) {
    let m = 1;
    let symbol = 0;
    for (let i = 0; i < bits; i++) {
      const bit = this.bit(probs, at + m);
      m = (m << 1) + bit;
      symbol |= bit << i;
    }
    return symbol;
  }
}
