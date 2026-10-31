// XXH64, the checksum a Zstandard frame ends with. JavaScript numbers hold 53 bits and BigInt is
// slow, so every 64-bit value is a pair of unsigned 32-bit words (high, low); the operations leave
// their result in H and L.

const P1H = 0x9e3779b1;
const P1L = 0x85ebca87;
const P2H = 0xc2b2ae3d;
const P2L = 0x27d4eb4f;
const P3H = 0x165667b1;
const P3L = 0x9e3779f9;
const P4H = 0x85ebca77;
const P4L = 0xc2b2ae63;
const P5H = 0x27d4eb2f;
const P5L = 0x165667c5;

let H = 0;
let L = 0;

/** (ah, al) * (bh, bl), modulo 2^64. */
function mul(
  /** @type {number} */ ah,
  /** @type {number} */ al,
  /** @type {number} */ bh,
  /** @type {number} */ bl,
) {
  const a0 = al & 0xffff;
  const a1 = al >>> 16;
  const b0 = bl & 0xffff;
  const b1 = bl >>> 16;
  const p00 = a0 * b0;
  const p01 = a0 * b1;
  const p10 = a1 * b0;
  const p11 = a1 * b1;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  L = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0;
  H =
    (p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16) + Math.imul(ah, bl) + Math.imul(al, bh)) >>>
    0;
}

/** (ah, al) + (bh, bl), modulo 2^64. */
function add(
  /** @type {number} */ ah,
  /** @type {number} */ al,
  /** @type {number} */ bh,
  /** @type {number} */ bl,
) {
  const low = al + bl;
  L = low >>> 0;
  H = (ah + bh + (low > 0xffffffff ? 1 : 0)) >>> 0;
}

/** Rotate left by 0 < n < 32. */
function rotl(/** @type {number} */ h, /** @type {number} */ l, /** @type {number} */ n) {
  H = ((h << n) | (l >>> (32 - n))) >>> 0;
  L = ((l << n) | (h >>> (32 - n))) >>> 0;
}

/** acc + input * P2, rotated by 31, times P1. */
function round(
  /** @type {number} */ ah,
  /** @type {number} */ al,
  /** @type {number} */ ih,
  /** @type {number} */ il,
) {
  mul(ih, il, P2H, P2L);
  add(ah, al, H, L);
  rotl(H, L, 31);
  mul(H, L, P1H, P1L);
}

const word = (/** @type {Uint8Array} */ b, /** @type {number} */ o) =>
  /** @type {number} */ (
    b[o] |
      /** @type {number} */ (b[o + 1] << 8) |
      /** @type {number} */ (b[o + 2] << 16) |
      /** @type {number} */ (b[o + 3] << 24)
  ) >>> 0;

/** XXH64 with seed 0, fed chunk by chunk. */
export class Xxh64 {
  constructor() {
    /** The four lanes: high and low word each. */
    this.v = new Uint32Array(8);
    add(P1H, P1L, P2H, P2L);
    this.v[0] = H;
    this.v[1] = L;
    this.v[2] = P2H;
    this.v[3] = P2L;
    // -P1, two's complement
    const low = (~P1L + 1) >>> 0;
    this.v[6] = (~P1H + (low === 0 ? 1 : 0)) >>> 0;
    this.v[7] = low;
    this.buf = new Uint8Array(32);
    this.held = 0;
    this.total = 0;
  }

  /** @param {Uint8Array} b @param {number} o */
  stripe(b, o) {
    const v = this.v;
    for (let k = 0; k < 8; k += 2) {
      round(
        /** @type {number} */ (v[k]),
        /** @type {number} */ (v[k + 1]),
        word(b, o + k * 4 + 4),
        word(b, o + k * 4),
      );
      v[k] = H;
      v[k + 1] = L;
    }
  }

  /** @param {Uint8Array} b */
  update(b) {
    this.total += b.length;
    let i = 0;
    if (this.held) {
      const take = Math.min(32 - this.held, b.length);
      this.buf.set(b.subarray(0, take), this.held);
      this.held += take;
      i = take;
      if (this.held < 32) return;
      this.stripe(this.buf, 0);
      this.held = 0;
    }
    for (; i + 32 <= b.length; i += 32) this.stripe(b, i);
    if (i < b.length) {
      this.buf.set(b.subarray(i), 0);
      this.held = b.length - i;
    }
  }

  /** The digest's low 32 bits, which a Zstandard frame stores. */
  low32() {
    return this.digest()[1];
  }

  /** The digest as [high, low]. @returns {[number, number]} */
  digest() {
    const v = this.v;
    let h = 0;
    let l = 0;
    if (this.total >= 32) {
      rotl(/** @type {number} */ (v[0]), /** @type {number} */ (v[1]), 1);
      h = H;
      l = L;
      for (const [k, n] of [
        [2, 7],
        [4, 12],
        [6, 18],
      ]) {
        rotl(
          /** @type {number} */ (v[/** @type {number} */ (k)]),
          /** @type {number} */ (v[/** @type {number} */ (k) + 1]),
          /** @type {number} */ (n),
        );
        add(h, l, H, L);
        h = H;
        l = L;
      }
      for (let k = 0; k < 8; k += 2) {
        round(0, 0, /** @type {number} */ (v[k]), /** @type {number} */ (v[k + 1]));
        mul((h ^ H) >>> 0, (l ^ L) >>> 0, P1H, P1L);
        add(H, L, P4H, P4L);
        h = H;
        l = L;
      }
    } else {
      h = P5H;
      l = P5L;
    }
    add(h, l, Math.floor(this.total / 0x100000000) >>> 0, this.total >>> 0);
    h = H;
    l = L;
    const b = this.buf;
    const n = this.held;
    let p = 0;
    for (; p + 8 <= n; p += 8) {
      round(0, 0, word(b, p + 4), word(b, p));
      rotl((h ^ H) >>> 0, (l ^ L) >>> 0, 27);
      mul(H, L, P1H, P1L);
      add(H, L, P4H, P4L);
      h = H;
      l = L;
    }
    if (p + 4 <= n) {
      mul(0, word(b, p), P1H, P1L);
      rotl((h ^ H) >>> 0, (l ^ L) >>> 0, 23);
      mul(H, L, P2H, P2L);
      add(H, L, P3H, P3L);
      h = H;
      l = L;
      p += 4;
    }
    for (; p < n; p++) {
      mul(0, /** @type {number} */ (b[p]), P5H, P5L);
      rotl((h ^ H) >>> 0, (l ^ L) >>> 0, 11);
      mul(H, L, P1H, P1L);
      h = H;
      l = L;
    }
    l = (l ^ (h >>> 1)) >>> 0;
    mul(h, l, P2H, P2L);
    h = H;
    l = (L ^ ((L >>> 29) | (H << 3))) >>> 0;
    h = (h ^ (h >>> 29)) >>> 0;
    mul(h, l, P3H, P3L);
    return [H, (L ^ H) >>> 0];
  }
}
