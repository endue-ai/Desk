// Picture sizes from video bitstreams, for containers that do not write them: an H.264 sequence
// parameter set (FLV, MPEG-TS, MPEG-PS) and an MPEG-1/2 sequence header.

/** A bit reader over an RBSP (emulation prevention bytes already removed). */
class Bits {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }
  bit() {
    const byte = this.bytes[this.pos >> 3] ?? 0;
    const bit = (byte >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return bit;
  }
  /** @param {number} n */
  bits(n) {
    let value = 0;
    for (let i = 0; i < n; i++) value = value * 2 + this.bit();
    return value;
  }
  /** Exp-Golomb, unsigned. */
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

/** The NAL unit's payload without emulation prevention bytes (00 00 03). */
function rbsp(/** @type {Uint8Array} */ nal) {
  const out = [];
  for (let i = 0; i < nal.length; i++) {
    if (i >= 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
    out.push(nal[i] ?? 0);
  }
  return Uint8Array.from(out);
}

const HIGH = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];

/**
 * The display size an H.264 SPS describes; `sps` starts at the NAL header byte.
 * @param {Uint8Array} sps
 * @returns {{ width: number, height: number } | null}
 */
export function spsSize(sps) {
  if (sps.length < 4 || ((sps[0] ?? 0) & 0x1f) !== 7) return null;
  const b = new Bits(rbsp(sps.subarray(1)));
  const profile = b.bits(8);
  b.bits(16);
  b.ue();
  let chroma = 1;
  if (HIGH.includes(profile)) {
    chroma = b.ue();
    if (chroma === 3) b.bit();
    b.ue();
    b.ue();
    b.bit();
    if (b.bit()) {
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
  }
  b.ue();
  const poc = b.ue();
  if (poc === 0) b.ue();
  else if (poc === 1) {
    b.bit();
    b.se();
    b.se();
    const cycle = b.ue();
    for (let i = 0; i < cycle && i < 256; i++) b.se();
  }
  b.ue();
  b.bit();
  const widthMbs = b.ue() + 1;
  const heightUnits = b.ue() + 1;
  const frameOnly = b.bit();
  if (!frameOnly) b.bit();
  b.bit();
  let [left, right, top, bottom] = [0, 0, 0, 0];
  if (b.bit()) [left, right, top, bottom] = [b.ue(), b.ue(), b.ue(), b.ue()];
  const unitX = chroma === 1 || chroma === 2 ? 2 : 1;
  const unitY = (chroma === 1 ? 2 : 1) * (2 - frameOnly);
  const width = widthMbs * 16 - (left + right) * unitX;
  const height = (2 - frameOnly) * heightUnits * 16 - (top + bottom) * unitY;
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The first H.264 SPS in an Annex B byte stream (00 00 01 start codes), as its size. */
export function annexBSize(/** @type {Uint8Array} */ bytes) {
  for (let i = 0; i + 4 < bytes.length; i++) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0 || bytes[i + 2] !== 1) continue;
    // An SPS NAL header: forbidden bit clear, a reference idc, type 7 (MPEG-2's slice 7 has no idc).
    const nal = bytes[i + 3] ?? 0;
    if ((nal & 0x9f) !== 7 || (nal & 0x60) === 0) continue;
    let end = i + 4;
    while (
      end + 3 < bytes.length &&
      !(bytes[end] === 0 && bytes[end + 1] === 0 && (bytes[end + 2] ?? 2) <= 1)
    )
      end++;
    return spsSize(bytes.subarray(i + 3, end + 3 < bytes.length ? end : bytes.length));
  }
  return null;
}

/** An MPEG-1/2 sequence header (00 00 01 B3) in `bytes`: its size, and whether MPEG-2 extends it. */
export function mpegVideoSize(/** @type {Uint8Array} */ bytes) {
  for (let i = 0; i + 8 < bytes.length; i++) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0 || bytes[i + 2] !== 1 || bytes[i + 3] !== 0xb3)
      continue;
    const width = ((bytes[i + 4] ?? 0) << 4) | ((bytes[i + 5] ?? 0) >> 4);
    const height = (((bytes[i + 5] ?? 0) & 15) << 8) | (bytes[i + 6] ?? 0);
    let mpeg2 = false;
    for (let j = i + 8; j + 4 < Math.min(bytes.length, i + 400); j++)
      if (bytes[j] === 0 && bytes[j + 1] === 0 && bytes[j + 2] === 1 && bytes[j + 3] === 0xb5)
        mpeg2 = true;
    return { width, height, mpeg2 };
  }
  return null;
}
