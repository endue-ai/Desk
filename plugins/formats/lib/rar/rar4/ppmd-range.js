// RAR's range decoder for PPMd: Dmitry Subbotin's carryless range coder with kTop 1 << 24 and
// kBot 1 << 15, after the public-domain PPMd var.H by Dmitry Shkarin and Igor Pavlov's LZMA SDK
// (Ppmd7), as carried by libarchive (PpmdRAR_RangeDec). All arithmetic is unsigned 32-bit.

const TOP = 1 << 24;
const BOT = 1 << 15;

export class RangeDecoder {
  /** @param {{ byte(): number }} input next byte of the packed stream (0 past its end) */
  constructor(input) {
    this.input = input;
    this.low = 0;
    this.range = 0;
    this.code = 0;
  }

  /** Reads the first four bytes. Returns false when they cannot start a stream. */
  init() {
    this.low = 0;
    this.range = 0xffffffff;
    let code = 0;
    for (let i = 0; i < 4; i++) code = ((code << 8) | this.input.byte()) >>> 0;
    this.code = code;
    return code < 0xffffffff;
  }

  /**
   * Scales the range to `total` and returns where the next symbol falls in 0..total - 1. A value
   * of `total` or more means damaged data; so does every call after the range has run out.
   * @param {number} total
   */
  threshold(total) {
    const range = (this.range / total) >>> 0;
    this.range = range;
    if (range === 0) return total;
    return (((this.code - this.low) >>> 0) / range) >>> 0;
  }

  /**
   * Takes the symbol at start..start + size - 1 of the last threshold's total off the stream.
   * @param {number} start @param {number} size
   */
  decode(start, size) {
    let low = (this.low + start * this.range) >>> 0;
    let range = (this.range * size) >>> 0;
    let code = this.code;
    for (;;) {
      if ((low ^ (low + range)) >>> 0 >= TOP) {
        if (range >= BOT) break;
        range = -low & (BOT - 1);
      }
      code = ((code << 8) | this.input.byte()) >>> 0;
      range = (range << 8) >>> 0;
      low = (low << 8) >>> 0;
    }
    this.low = low;
    this.range = range;
    this.code = code;
  }
}
