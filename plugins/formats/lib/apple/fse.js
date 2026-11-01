// The tables of an LZFSE compressed block: its header (bvx1 keeps the fields whole, bvx2 packs them
// into three 64-bit words and the frequencies into a variable-length code), and the FSE (finite
// state entropy, tANS) decoder tables built from the frequencies. Written after Apple's LZFSE
// reference implementation (lzfse_internal.h, lzfse_fse.c, lzfse_decode_base.c), BSD-3-Clause;
// see NOTICE.

export const L_STATES = 64;
export const M_STATES = 64;
export const D_STATES = 256;
export const LITERAL_STATES = 1024;
export const MATCHES_PER_BLOCK = 10000;
export const LITERALS_PER_BLOCK = 4 * MATCHES_PER_BLOCK;
const L_SYMBOLS = 20;
const M_SYMBOLS = 20;
const D_SYMBOLS = 64;
const LITERAL_SYMBOLS = 256;
const FREQUENCIES = L_SYMBOLS + M_SYMBOLS + D_SYMBOLS + LITERAL_SYMBOLS;
/** Where each table's frequencies start in the header's run of them. */
export const FREQ_L = 0;
export const FREQ_M = FREQ_L + L_SYMBOLS;
export const FREQ_D = FREQ_M + M_SYMBOLS;
export const FREQ_LITERAL = FREQ_D + D_SYMBOLS;
/** Bytes of a bvx1 header: the fields, then 360 frequencies of 16 bits, padded to four bytes. */
export const V1_HEADER = 772;
const V2_FIXED = 32;

// Each L, M and D value is a base the FSE symbol names plus that many extra bits read raw.
const L_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 5, 8];
const L_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 28, 60];
const M_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 5, 8, 11];
const M_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 24, 56, 312];
const D_EXTRA = Array.from({ length: D_SYMBOLS }, (_, i) => i >> 2);
const D_BASE = [
  0, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 36, 44, 52, 60, 76, 92, 108, 124, 156, 188, 220, 252,
  316, 380, 444, 508, 636, 764, 892, 1020, 1276, 1532, 1788, 2044, 2556, 3068, 3580, 4092, 5116,
  6140, 7164, 8188, 10236, 12284, 14332, 16380, 20476, 24572, 28668, 32764, 40956, 49148, 57340,
  65532, 81916, 98300, 114684, 131068, 163836, 196604, 229372,
];

/**
 * @typedef {{
 *   rawBytes: number, literals: number, matches: number, literalPayload: number,
 *   lmdPayload: number, literalBits: number, literalStates: number[], lmdBits: number,
 *   lState: number, mState: number, dState: number, size: number, freq: Uint16Array,
 * }} BlockHeader `size` is the header's own length in bytes; `literalBits` and `lmdBits` how many
 * bits of each stream's last 32-bit word hold data, less 32 (-7 to 0).
 */

/** @param {string} why */
const damaged = (why) => new Error(`The LZFSE stream is damaged: ${why}.`);
const endsEarly = () => new Error("The LZFSE stream ends early.");

/** @param {Uint8Array} b @param {number} o */
const u16 = (b, o) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
/** @param {Uint8Array} b @param {number} o */
export const u32 = (b, o) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;
/** @param {Uint8Array} b @param {number} o */
const i32 = (b, o) => u32(b, o) | 0;

/**
 * Bits `offset` to `offset + bits - 1` (at most 32 of them) of the little-endian 64-bit word at `o`.
 * @param {Uint8Array} b @param {number} o @param {number} offset @param {number} bits
 */
function field(b, o, offset, bits) {
  const lo = u32(b, o);
  const hi = u32(b, o + 4);
  let value;
  if (offset >= 32) value = hi >>> (offset - 32);
  else if (offset === 0) value = lo;
  else value = ((lo >>> offset) | (hi << (32 - offset))) >>> 0;
  return bits === 32 ? value >>> 0 : value & ((1 << bits) - 1);
}

/** A bvx1 header at `at` (its magic included). @param {Uint8Array} src @param {number} at @returns {BlockHeader} */
export function headerV1(src, at) {
  if (at + V1_HEADER > src.length) throw endsEarly();
  const freq = new Uint16Array(FREQUENCIES);
  for (let i = 0; i < FREQUENCIES; i++) freq[i] = u16(src, at + 50 + 2 * i);
  return {
    rawBytes: u32(src, at + 4),
    literals: u32(src, at + 12),
    matches: u32(src, at + 16),
    literalPayload: u32(src, at + 20),
    lmdPayload: u32(src, at + 24),
    literalBits: i32(src, at + 28),
    literalStates: [0, 1, 2, 3].map((i) => u16(src, at + 32 + 2 * i)),
    lmdBits: i32(src, at + 40),
    lState: u16(src, at + 44),
    mState: u16(src, at + 46),
    dState: u16(src, at + 48),
    size: V1_HEADER,
    freq,
  };
}

// The frequency code: the low five bits pick a length and a value; 8- and 14-bit codes carry more.
const FREQ_BITS = [
  2, 3, 2, 5, 2, 3, 2, 8, 2, 3, 2, 5, 2, 3, 2, 14, 2, 3, 2, 5, 2, 3, 2, 8, 2, 3, 2, 5, 2, 3, 2, 14,
];
const FREQ_VALUES = [
  0, 2, 1, 4, 0, 3, 1, -1, 0, 2, 1, 5, 0, 3, 1, -1, 0, 2, 1, 6, 0, 3, 1, -1, 0, 2, 1, 7, 0, 3, 1,
  -1,
];

/** A bvx2 header at `at` (its magic included). @param {Uint8Array} src @param {number} at @returns {BlockHeader} */
export function headerV2(src, at) {
  if (at + V2_FIXED > src.length) throw endsEarly();
  const v0 = at + 8;
  const v1 = at + 16;
  const v2 = at + 24;
  const size = field(src, v2, 0, 32);
  if (size < V2_FIXED) throw damaged("a block header is too short");
  if (at + size > src.length) throw endsEarly();
  const freq = new Uint16Array(FREQUENCIES);
  const end = at + size;
  let p = at + V2_FIXED;
  if (p < end) {
    let accum = 0;
    let bits = 0;
    for (let i = 0; i < FREQUENCIES; i++) {
      while (p < end && bits + 8 <= 32) {
        accum = (accum | ((src[p++] ?? 0) << bits)) >>> 0;
        bits += 8;
      }
      const low = accum & 31;
      const n = FREQ_BITS[low] ?? 2;
      let value = FREQ_VALUES[low] ?? 0;
      if (n === 8) value = 8 + ((accum >>> 4) & 0xf);
      else if (n === 14) value = 24 + ((accum >>> 4) & 0x3ff);
      if (n > bits) throw damaged("a block's frequency table ends early");
      freq[i] = value;
      accum >>>= n;
      bits -= n;
    }
    if (bits >= 8 || p !== end) throw damaged("a block's frequency table has the wrong size");
  }
  return {
    rawBytes: u32(src, at + 4),
    literals: field(src, v0, 0, 20),
    literalPayload: field(src, v0, 20, 20),
    matches: field(src, v0, 40, 20),
    literalBits: field(src, v0, 60, 3) - 7,
    literalStates: [0, 10, 20, 30].map((o) => field(src, v1, o, 10)),
    lmdPayload: field(src, v1, 40, 20),
    lmdBits: field(src, v1, 60, 3) - 7,
    lState: field(src, v2, 32, 10),
    mState: field(src, v2, 42, 10),
    dState: field(src, v2, 52, 10),
    size,
    freq,
  };
}

/** @param {Uint16Array} freq @param {number} from @param {number} count @param {number} states */
function fits(freq, from, count, states) {
  let sum = 0;
  for (let i = from; i < from + count; i++) sum += freq[i] ?? 0;
  return sum <= states;
}

/** The reference's checks on a header's counts, states and frequencies. @param {BlockHeader} h */
export function checkHeader(h) {
  const ok =
    h.literals <= LITERALS_PER_BLOCK &&
    h.matches <= MATCHES_PER_BLOCK &&
    h.literalStates.every((s) => s < LITERAL_STATES) &&
    h.lState < L_STATES &&
    h.mState < M_STATES &&
    h.dState < D_STATES &&
    h.literalBits >= -7 &&
    h.literalBits <= 0 &&
    h.lmdBits >= -7 &&
    h.lmdBits <= 0 &&
    fits(h.freq, FREQ_L, L_SYMBOLS, L_STATES) &&
    fits(h.freq, FREQ_M, M_SYMBOLS, M_STATES) &&
    fits(h.freq, FREQ_D, D_SYMBOLS, D_STATES) &&
    fits(h.freq, FREQ_LITERAL, LITERAL_SYMBOLS, LITERAL_STATES);
  if (!ok) throw damaged("a block header is out of range");
}

/**
 * The literal decoder: for each state, (next state base << 16) | (symbol << 8) | bits to read.
 * @param {Uint16Array} freq @param {Int32Array} table
 */
export function literalTable(freq, table) {
  const clz = Math.clz32(LITERAL_STATES);
  let t = 0;
  for (let symbol = 0; symbol < LITERAL_SYMBOLS; symbol++) {
    const f = freq[FREQ_LITERAL + symbol] ?? 0;
    if (!f) continue;
    const k = Math.clz32(f) - clz;
    const j0 = ((2 * LITERAL_STATES) >> k) - f;
    for (let j = 0; j < f; j++) {
      table[t++] =
        j < j0
          ? ((((f + j) << k) - LITERAL_STATES) << 16) | (symbol << 8) | k
          : (((j - j0) << (k - 1)) << 16) | (symbol << 8) | (k - 1);
    }
  }
}

/**
 * A value decoder (L, M or D): for each state, `info` holds the bits to read in all (state bits and
 * extra bits) | (extra bits << 8) | (next state base << 16), and `base` the value's base.
 * @typedef {{ info: Int32Array, base: Int32Array }} ValueTable
 */

/** @param {number} states @returns {ValueTable} */
export const valueTable = (states) => ({
  info: new Int32Array(states),
  base: new Int32Array(states),
});

/**
 * @param {"l" | "m" | "d"} which @param {Uint16Array} freq @param {ValueTable} table
 */
export function buildValueTable(which, freq, table) {
  const [from, symbols, states, extra, bases] =
    which === "l"
      ? [FREQ_L, L_SYMBOLS, L_STATES, L_EXTRA, L_BASE]
      : which === "m"
        ? [FREQ_M, M_SYMBOLS, M_STATES, M_EXTRA, M_BASE]
        : [FREQ_D, D_SYMBOLS, D_STATES, D_EXTRA, D_BASE];
  const clz = Math.clz32(states);
  let t = 0;
  for (let symbol = 0; symbol < symbols; symbol++) {
    const f = freq[from + symbol] ?? 0;
    if (!f) continue;
    const k = Math.clz32(f) - clz;
    const j0 = ((2 * states) >> k) - f;
    const vbits = extra[symbol] ?? 0;
    const vbase = bases[symbol] ?? 0;
    for (let j = 0; j < f; j++, t++) {
      const bits = j < j0 ? k : k - 1;
      const delta = j < j0 ? ((f + j) << k) - states : (j - j0) << (k - 1);
      table.info[t] = (bits + vbits) | (vbits << 8) | (delta << 16);
      table.base[t] = vbase;
    }
  }
}
