// The packed data of one entry, read from the source a chunk at a time and taken bit by bit, the
// most significant bit first, as both RAR formats store it. Decoders call `ensure` (async) before a
// stretch of work and then read synchronously; past the loaded bytes they read zeros.

/** @typedef {{ size: number, read(offset: number, length: number): Promise<Uint8Array> }} Source */

const CHUNK = 1 << 20;
const PAD = 16;
export const TRUNCATED = "The RAR archive ends early: the file is cut short.";

export class Input {
  /** @param {Source} source @param {number} start @param {number} length */
  constructor(source, start, length) {
    this.source = source;
    /** Where the packed data starts in the source, and how long it is. */
    this.start = start;
    this.length = length;
    this.buf = new Uint8Array(PAD);
    /** The packed-data offset of buf[0], and how many bytes of buf hold data. */
    this.base = 0;
    this.filled = 0;
    /** The read position, in bits from buf[0]. */
    this.pos = 0;
  }

  /** Bytes of packed data from the current position to its end, loaded or not. */
  get left() {
    return this.length - this.base - (this.pos >>> 3);
  }

  /** Bytes from the current position that are loaded. */
  get ready() {
    return this.filled - (this.pos >>> 3);
  }

  /** Whether reading went past the end of the packed data. */
  get over() {
    return this.pos > (this.length - this.base) * 8;
  }

  /** Loads at least `bytes` bytes from the current position, or all that remain. @param {number} bytes */
  async ensure(bytes) {
    const want = Math.min(bytes, Math.max(0, this.left));
    if (this.ready >= want) return;
    const keep = Math.min(this.pos >>> 3, this.filled);
    const rest = this.filled - keep;
    const from = this.base + this.filled;
    const count = Math.min(Math.max(want, CHUNK) - rest, this.length - from);
    let buf = this.buf;
    if (rest + count + PAD > buf.length) {
      buf = new Uint8Array(rest + count + PAD);
      buf.set(this.buf.subarray(keep, this.filled));
    } else buf.copyWithin(0, keep, this.filled);
    if (from + count > this.length || this.start + from + count > this.source.size)
      throw new Error(TRUNCATED);
    const got = count > 0 ? await this.source.read(this.start + from, count) : buf.subarray(0, 0);
    if (got.length < count) throw new Error(TRUNCATED);
    buf.set(got, rest);
    buf.fill(0, rest + count, rest + count + PAD);
    this.buf = buf;
    this.base += keep;
    this.pos -= keep * 8;
    this.filled = rest + count;
  }

  /** The next 16 bits, not taken. */
  peek16() {
    const b = this.buf;
    const i = this.pos >>> 3;
    return (((b[i] << 16) | (b[i + 1] << 8) | b[i + 2]) >>> (8 - (this.pos & 7))) & 0xffff;
  }

  /** Takes `n` bits (0 to 16). @param {number} n */
  bits(n) {
    const v = this.peek16() >>> (16 - n);
    this.pos += n;
    return v;
  }

  /** Takes `n` bits (0 to 32). @param {number} n */
  long(n) {
    if (n <= 16) return this.bits(n);
    const high = this.bits(16);
    return (high * (1 << (n - 16)) + this.bits(n - 16)) >>> 0;
  }

  byte() {
    return this.bits(8);
  }

  /** Moves to the next byte boundary. */
  align() {
    this.pos = (this.pos + 7) & ~7;
  }
}
