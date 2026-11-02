// H.264 and HEVC NAL units (ITU-T H.264 and H.265, ISO/IEC 14496-15): Annex B byte streams split at
// their start codes and written length-prefixed, the avcC and hvcC configuration records built from
// the parameter sets, and an H.264 picture's order count for containers that store no PTS.
import { Writer } from "./boxes.js";

/** A bit reader over an RBSP: the NAL unit's bytes without emulation prevention (00 00 03). */
export class Bits {
  /** @param {Uint8Array} nal the NAL unit, header included; `skip` header bytes are left out */
  constructor(nal, skip = 0) {
    const out = [];
    for (let i = skip; i < nal.length; i++) {
      if (i >= skip + 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
      out.push(nal[i] ?? 0);
    }
    this.bytes = Uint8Array.from(out);
    this.pos = 0;
  }
  bit() {
    const byte = this.bytes[this.pos >> 3] ?? 0;
    this.pos++;
    return (byte >> (7 - ((this.pos - 1) & 7))) & 1;
  }
  /** @param {number} n */
  bits(n) {
    let value = 0;
    for (let i = 0; i < n; i++) value = value * 2 + this.bit();
    return value;
  }
  ue() {
    let zeros = 0;
    while (this.bit() === 0 && zeros < 32) zeros++;
    return 2 ** zeros - 1 + this.bits(zeros);
  }
  se() {
    const value = this.ue();
    return value & 1 ? (value + 1) / 2 : -value / 2;
  }
}

/** The NAL units of an Annex B byte stream, without start codes or trailing zero bytes. */
export function splitAnnexB(/** @type {Uint8Array} */ bytes) {
  /** @type {Uint8Array[]} */
  const out = [];
  let start = -1;
  const push = (/** @type {number} */ end) => {
    let e = end;
    while (e > start && bytes[e - 1] === 0) e--;
    if (start >= 0 && e > start) out.push(bytes.subarray(start, e));
  };
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0 || bytes[i + 2] !== 1) continue;
    push(i);
    start = i + 3;
    i += 2;
  }
  if (start >= 0) push(bytes.length);
  return out;
}

/** Whether a sample is an Annex B byte stream rather than length-prefixed NAL units. */
export const isAnnexB = (/** @type {Uint8Array} */ b) =>
  b[0] === 0 && b[1] === 0 && (b[2] === 1 || (b[2] === 0 && b[3] === 1));

/** The NAL units of a length-prefixed sample (`size` bytes a length). */
export function splitPrefixed(/** @type {Uint8Array} */ bytes, size = 4) {
  /** @type {Uint8Array[]} */
  const out = [];
  for (let at = 0; at + size <= bytes.length; ) {
    let length = 0;
    for (let i = 0; i < size; i++) length = length * 256 + (bytes[at + i] ?? 0);
    at += size;
    if (length === 0 || at + length > bytes.length) break;
    out.push(bytes.subarray(at, at + length));
    at += length;
  }
  return out;
}

/** NAL units written with four-byte lengths. */
export function prefixed(/** @type {Uint8Array[]} */ nals) {
  const w = new Writer(nals.reduce((n, nal) => n + nal.length + 4, 0));
  for (const nal of nals) w.u32(nal.length).put(nal);
  return w.done();
}

export const avcType = (/** @type {Uint8Array} */ nal) => (nal[0] ?? 0) & 0x1f;
export const hevcType = (/** @type {Uint8Array} */ nal) => ((nal[0] ?? 0) >> 1) & 0x3f;

const HIGH = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];

/**
 * What an H.264 SPS says about picture order and chroma (H.264 7.3.2.1.1).
 * @param {Uint8Array} sps the NAL unit, header included
 */
export function readSps(sps) {
  const b = new Bits(sps, 1);
  const profile = b.bits(8);
  b.bits(16);
  b.ue();
  let chroma = 1;
  let separate = 0;
  let lumaDepth = 0;
  let chromaDepth = 0;
  if (HIGH.includes(profile)) {
    chroma = b.ue();
    if (chroma === 3) separate = b.bit();
    lumaDepth = b.ue();
    chromaDepth = b.ue();
    b.bit();
    if (b.bit())
      for (let i = 0; i < (chroma === 3 ? 12 : 8); i++) {
        if (!b.bit()) continue;
        let last = 8;
        let next = 8;
        for (let j = 0; j < (i < 6 ? 16 : 64) && next !== 0; j++) {
          next = (last + b.se() + 256) % 256;
          if (next !== 0) last = next;
        }
      }
  }
  const frameNumBits = b.ue() + 4;
  const pocType = b.ue();
  let pocBits = 0;
  if (pocType === 0) pocBits = b.ue() + 4;
  else if (pocType === 1) {
    b.bit();
    b.se();
    b.se();
    const cycle = b.ue();
    for (let i = 0; i < cycle && i < 256; i++) b.se();
  }
  b.ue();
  b.bit();
  b.ue();
  b.ue();
  const frameOnly = b.bit();
  return {
    profile,
    chroma,
    separate,
    lumaDepth,
    chromaDepth,
    frameNumBits,
    pocType,
    pocBits,
    frameOnly,
  };
}

/** An avcC record (ISO/IEC 14496-15 5.3.3.1) for the parameter sets, four-byte lengths. */
export function avcC(/** @type {Uint8Array[]} */ spss, /** @type {Uint8Array[]} */ ppss) {
  const sps = spss[0];
  if (!sps) throw new Error("This H.264 video has no sequence parameter set.");
  const w = new Writer();
  w.u8(1)
    .u8(sps[1] ?? 0)
    .u8(sps[2] ?? 0)
    .u8(sps[3] ?? 0)
    .u8(0xff)
    .u8(0xe0 | spss.length);
  for (const s of spss) w.u16(s.length).put(s);
  w.u8(ppss.length);
  for (const p of ppss) w.u16(p.length).put(p);
  const info = readSps(sps);
  if (HIGH.includes(info.profile) && info.profile !== 44)
    w.u8(0xfc | info.chroma)
      .u8(0xf8 | info.lumaDepth)
      .u8(0xf8 | info.chromaDepth)
      .u8(0);
  return w.done();
}

/** The parameter sets an avcC record holds, and its length size. */
export function readAvcC(/** @type {Uint8Array} */ record) {
  const size = ((record[4] ?? 3) & 3) + 1;
  /** @type {Uint8Array[]} */
  const sets = [];
  let at = 5;
  for (const count of [0, 1]) {
    const n = count === 0 ? (record[at++] ?? 0) & 0x1f : (record[at++] ?? 0);
    for (let i = 0; i < n && at + 2 <= record.length; i++) {
      const length = ((record[at] ?? 0) << 8) | (record[at + 1] ?? 0);
      sets.push(record.subarray(at + 2, at + 2 + length));
      at += 2 + length;
    }
  }
  return { size, sets };
}

/**
 * The picture order count of one H.264 access unit, following H.264 8.2.1.1 for POC type 0; type 2
 * (and 1) count in decode order. `state` carries the previous reference picture between calls.
 * @param {Uint8Array[]} nals the access unit's NAL units
 * @param {ReturnType<typeof readSps>} sps
 * @param {{ msb: number, lsb: number, epoch: number, count: number }} state
 */
export function pictureOrder(nals, sps, state) {
  const slice = nals.find((n) => avcType(n) === 1 || avcType(n) === 5);
  if (!slice) return state.epoch * 2 ** 32 + state.count++;
  const idr = avcType(slice) === 5;
  const reference = ((slice[0] ?? 0) >> 5) & 3;
  if (idr) {
    state.epoch++;
    state.msb = 0;
    state.lsb = 0;
    state.count = 0;
  }
  if (sps.pocType !== 0) return state.epoch * 2 ** 32 + state.count++;
  const b = new Bits(slice, 1);
  b.ue();
  b.ue();
  b.ue();
  if (sps.separate) b.bits(2);
  b.bits(sps.frameNumBits);
  if (!sps.frameOnly && b.bit()) b.bit();
  if (idr) b.ue();
  const lsb = b.bits(sps.pocBits);
  const max = 2 ** sps.pocBits;
  let msb = state.msb;
  if (lsb < state.lsb && state.lsb - lsb >= max / 2) msb += max;
  else if (lsb > state.lsb && lsb - state.lsb > max / 2) msb -= max;
  if (reference) {
    state.msb = msb;
    state.lsb = lsb;
  }
  state.count++;
  return state.epoch * 2 ** 32 + (msb + lsb + 2 ** 31);
}

/** An hvcC record (ISO/IEC 14496-15 8.3.3.1) from VPS, SPS and PPS NAL units, four-byte lengths. */
export function hvcC(/** @type {Uint8Array[]} */ nals) {
  const sps = nals.find((n) => hevcType(n) === 33);
  if (!sps) throw new Error("This HEVC video has no sequence parameter set.");
  const b = new Bits(sps, 2);
  b.bits(4);
  const subLayers = b.bits(3);
  const nested = b.bit();
  const general = b.bytes.slice(1, 13); // profile_tier_level's general fields: 12 bytes
  b.pos = 8 + 96;
  const present = [];
  for (let i = 0; i < subLayers; i++) present.push([b.bit(), b.bit()]);
  if (subLayers > 0) for (let i = subLayers; i < 8; i++) b.bits(2);
  for (const [profile, level] of present) b.pos += (profile ? 88 : 0) + (level ? 8 : 0);
  b.ue();
  const chroma = b.ue();
  if (chroma === 3) b.bit();
  b.ue();
  b.ue();
  if (b.bit()) for (let i = 0; i < 4; i++) b.ue();
  const luma = b.ue();
  const chromaDepth = b.ue();
  const w = new Writer();
  w.u8(1)
    .put(general)
    .u16(0xf000)
    .u8(0xfc)
    .u8(0xfc | chroma)
    .u8(0xf8 | luma)
    .u8(0xf8 | chromaDepth);
  w.u16(0).u8(((subLayers + 1) << 3) | (nested << 2) | 3);
  const arrays = [32, 33, 34].map((type) => nals.filter((n) => hevcType(n) === type));
  w.u8(arrays.filter((a) => a.length > 0).length);
  for (const array of arrays) {
    if (array.length === 0) continue;
    w.u8(0x80 | hevcType(/** @type {Uint8Array} */ (array[0]))).u16(array.length);
    for (const nal of array) w.u16(nal.length).put(nal);
  }
  return w.done();
}
