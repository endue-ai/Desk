// XXH32, as LZ4 frames use it for their header, block and content checksums; fed in parts.

const P1 = 0x9e3779b1;
const P2 = 0x85ebca77;
const P3 = 0xc2b2ae3d;
const P4 = 0x27d4eb2f;
const P5 = 0x165667b1;

const rotl = (/** @type {number} */ x, /** @type {number} */ r) => (x << r) | (x >>> (32 - r));
const round = (/** @type {number} */ acc, /** @type {number} */ lane) =>
  Math.imul(rotl((acc + Math.imul(lane, P2)) | 0, 13), P1);
/** @param {Uint8Array} b @param {number} o */
const lane = (b, o) =>
  /** @type {number} */ (b[o]) |
  /** @type {number} */ (b[o + 1] << 8) |
  /** @type {number} */ (b[o + 2] << 16) |
  /** @type {number} */ (b[o + 3] << 24);

export class Xxh32 {
  constructor(seed = 0) {
    this.v = [(seed + P1 + P2) | 0, (seed + P2) | 0, seed | 0, (seed - P1) | 0];
    this.seed = seed;
    this.total = 0;
    this.rest = new Uint8Array(16);
    this.restLength = 0;
  }

  /** @param {Uint8Array} bytes */
  update(bytes) {
    let i = 0;
    this.total += bytes.length;
    const v = this.v;
    if (this.restLength) {
      const take = Math.min(16 - this.restLength, bytes.length);
      this.rest.set(bytes.subarray(0, take), this.restLength);
      this.restLength += take;
      i = take;
      if (this.restLength < 16) return this;
      for (let k = 0; k < 4; k++)
        v[k] = round(/** @type {number} */ (v[k]), lane(this.rest, k * 4));
      this.restLength = 0;
    }
    for (; i + 16 <= bytes.length; i += 16)
      for (let k = 0; k < 4; k++)
        v[k] = round(/** @type {number} */ (v[k]), lane(bytes, i + k * 4));
    this.rest.set(bytes.subarray(i), 0);
    this.restLength = bytes.length - i;
    return this;
  }

  digest() {
    const [a = 0, b = 0, c = 0, d = 0] = this.v;
    let h =
      this.total >= 16
        ? (rotl(a, 1) + rotl(b, 7) + rotl(c, 12) + rotl(d, 18)) | 0
        : (this.seed + P5) | 0;
    h = (h + this.total) | 0;
    const rest = this.rest;
    let i = 0;
    for (; i + 4 <= this.restLength; i += 4)
      h = Math.imul(rotl((h + Math.imul(lane(rest, i), P3)) | 0, 17), P4);
    for (; i < this.restLength; i++)
      h = Math.imul(rotl((h + Math.imul(/** @type {number} */ (rest[i]), P5)) | 0, 11), P1);
    h ^= h >>> 15;
    h = Math.imul(h, P2);
    h ^= h >>> 13;
    h = Math.imul(h, P3);
    h ^= h >>> 16;
    return h >>> 0;
  }
}

/** @param {Uint8Array} bytes */
export const xxh32 = (bytes) => new Xxh32().update(bytes).digest();
