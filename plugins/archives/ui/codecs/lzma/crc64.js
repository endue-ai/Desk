// CRC-64 as xz checks blocks with it (ECMA-182, reflected), kept in two 32-bit halves.

const LOW = new Uint32Array(256);
const HIGH = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let lo = n;
  let hi = 0;
  for (let k = 0; k < 8; k++) {
    const odd = lo & 1;
    lo = ((lo >>> 1) | ((hi & 1) << 31)) >>> 0;
    hi >>>= 1;
    if (odd) {
      lo = (lo ^ 0xd7870f42) >>> 0;
      hi = (hi ^ 0xc96c5795) >>> 0;
    }
  }
  LOW[n] = lo;
  HIGH[n] = hi;
}

export class Crc64 {
  constructor() {
    this.lo = 0xffffffff;
    this.hi = 0xffffffff;
  }

  /** @param {Uint8Array} bytes */
  update(bytes) {
    let lo = this.lo;
    let hi = this.hi;
    for (let i = 0; i < bytes.length; i++) {
      const at = (lo ^ /** @type {number} */ (bytes[i])) & 0xff;
      lo = (((lo >>> 8) | (hi << 24)) ^ /** @type {number} */ (LOW[at])) >>> 0;
      hi = ((hi >>> 8) ^ /** @type {number} */ (HIGH[at])) >>> 0;
    }
    this.lo = lo;
    this.hi = hi;
  }

  /** Whether the CRC equals the eight little-endian bytes xz stores. @param {Uint8Array} stored */
  matches(stored) {
    const lo = ~this.lo >>> 0;
    const hi = ~this.hi >>> 0;
    const at = (/** @type {number} */ i) =>
      ((stored[i] ?? 0) |
        ((stored[i + 1] ?? 0) << 8) |
        ((stored[i + 2] ?? 0) << 16) |
        ((stored[i + 3] ?? 0) << 24)) >>>
      0;
    return at(0) === lo && at(4) === hi;
  }
}
