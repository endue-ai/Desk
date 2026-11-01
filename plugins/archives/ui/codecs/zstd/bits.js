// Zstandard's backward bitstreams: written forwards, read from the last byte back, whose highest set
// bit marks where the data starts. Bits past the start read as zeros; `pos` going below zero is how
// a decoder learns it read too far.
import { damaged } from "../input.js";

export class BackBits {
  /** @param {Uint8Array} b @param {number} start @param {number} end exclusive */
  constructor(b, start, end) {
    if (end <= start || end > b.length) throw damaged("Zstandard", "a bitstream is empty");
    const last = /** @type {number} */ (b[end - 1]);
    if (last === 0) throw damaged("Zstandard", "a bitstream has no end mark");
    this.b = b;
    this.start = start;
    /** Bits left to read, below the end mark. */
    this.pos = (end - 1 - start) * 8 + (31 - Math.clz32(last));
  }

  /** The next `n` bits (at most 25) without reading them. @param {number} n */
  peek(n) {
    const p = this.pos - n;
    const b = this.b;
    if (p >= 0) {
      const i = this.start + (p >>> 3);
      const v = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
      return (v >>> (p & 7)) & ((1 << n) - 1);
    }
    if (this.pos <= 0) return 0;
    // Fewer than n bits are left: they are the high ones, and zeros follow them.
    const i = this.start;
    const v = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
    return ((v & ((1 << this.pos) - 1)) << -p) & ((1 << n) - 1);
  }

  /** Read `n` bits (up to 32). @param {number} n */
  read(n) {
    if (n === 0) return 0;
    if (n > 25) {
      const high = this.read(n - 16);
      return high * 65536 + this.read(16);
    }
    const v = this.peek(n);
    this.pos -= n;
    return v;
  }
}
