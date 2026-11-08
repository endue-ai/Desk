// Where a decoder's output goes: one entry's bytes (all of them, or the first `limit`), their CRC,
// or nothing when an entry before the wanted one in a solid stream is only passed through.

import { crc32 } from "./crc32.js";
import { DAMAGED } from "./entries.js";

export class Sink {
  /**
   * @param {number} size the entry's size, -1 when only decoding tells
   * @param {{ keep?: boolean, limit?: number, pace?: { done: number } }} [options]
   */
  constructor(size, { keep = true, limit = Number.POSITIVE_INFINITY, pace } = {}) {
    this.pace = pace;
    this.size = size;
    this.limit = keep ? limit : 0;
    this.keep = keep;
    this.out = new Uint8Array(keep ? Math.max(0, Math.min(size < 0 ? 1 << 16 : size, limit)) : 0);
    this.length = 0;
    this.crc = 0;
  }

  /** Whether the bytes asked for are all there and decoding can stop. */
  get done() {
    return this.keep && this.length >= this.limit && this.limit < this.whole;
  }

  get whole() {
    return this.size < 0 ? Number.POSITIVE_INFINITY : this.size;
  }

  /** @param {Uint8Array} bytes */
  write(bytes) {
    if (bytes.length === 0) return;
    if (this.length + bytes.length > this.whole) throw new Error(DAMAGED);
    if (this.keep) {
      if (this.length < this.limit) {
        const take = Math.min(bytes.length, this.limit - this.length);
        if (this.length + take > this.out.length) {
          const grown = new Uint8Array(
            Math.min(this.limit, Math.max(this.out.length * 2, this.length + take)),
          );
          grown.set(this.out.subarray(0, this.length));
          this.out = grown;
        }
        this.out.set(take === bytes.length ? bytes : bytes.subarray(0, take), this.length);
      }
      if (this.limit >= this.whole) this.crc = crc32(bytes, this.crc);
    }
    this.length += bytes.length;
    if (this.pace) this.pace.done += bytes.length;
  }

  /** The bytes kept. */
  bytes() {
    return this.out.length === Math.min(this.length, this.limit)
      ? this.out
      : this.out.slice(0, Math.min(this.length, this.limit));
  }
}
