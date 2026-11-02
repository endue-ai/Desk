// Audio frames the remuxer reads and the configuration records it writes: the AAC AudioSpecificConfig
// and ADTS (ISO/IEC 14496-3, 13818-7), AC-3 and E-AC-3 sync frames with dac3 and dec3 (ETSI TS 102
// 366 Annex F), Opus packet durations and dOps (RFC 6716, Opus in ISOBMFF), FLAC frame headers and
// dfLa (RFC 9639, FLAC in ISOBMFF).
import { Cursor } from "../bytes.js";
import { Writer } from "./boxes.js";
import { Bits } from "./nal.js";

export const AAC_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

/** An AudioSpecificConfig's object type, core sampling rate, channels and frame length. */
export function readAsc(/** @type {Uint8Array} */ asc) {
  const b = new Bits(asc);
  let type = b.bits(5);
  if (type === 31) type = 32 + b.bits(6);
  const index = b.bits(4);
  const rate = index === 15 ? b.bits(24) : (AAC_RATES[index] ?? 0);
  const channels = b.bits(4);
  let core = type;
  if (type === 5 || type === 29) {
    const ext = b.bits(4);
    if (ext === 15) b.bits(24);
    core = b.bits(5);
  }
  const short = [1, 2, 3, 4, 6, 7, 17, 19, 20, 21, 22, 23].includes(core) ? b.bit() : 0;
  return { type, rate, channels, frame: short ? 960 : 1024 };
}

/** A two-byte AudioSpecificConfig for plain AAC of `type` (2 is LC). */
export function makeAsc(
  /** @type {number} */ type,
  /** @type {number} */ rate,
  /** @type {number} */ channels,
) {
  const index = Math.max(0, AAC_RATES.indexOf(rate));
  return Uint8Array.of((type << 3) | (index >> 1), ((index & 1) << 7) | ((channels & 15) << 3));
}

/** An ADTS header at `at`: its length, the raw frame's offset and size, and the config it implies. */
export function adtsAt(/** @type {Uint8Array} */ b, /** @type {number} */ at) {
  if (b[at] !== 0xff || ((b[at + 1] ?? 0) & 0xf6) !== 0xf0) return null;
  const c = new Bits(b.subarray(at, at + 7));
  c.bits(15);
  const absent = c.bit();
  const type = c.bits(2) + 1;
  const index = c.bits(4);
  c.bit();
  const channels = c.bits(3);
  c.bits(4);
  const length = c.bits(13);
  const head = absent ? 7 : 9;
  if (length < head || !AAC_RATES[index]) return null;
  const rate = /** @type {number} */ (AAC_RATES[index]);
  return { length, head, rate, channels, asc: makeAsc(type, rate, channels) };
}

const AC3_RATES = [48000, 44100, 32000];
const AC3_KBPS = [
  32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640,
];

/**
 * An AC-3 or E-AC-3 sync frame at `at` (A/52 5.3, E.1.2): its length, samples, rate, and the
 * fields dac3 and dec3 carry.
 * @param {Uint8Array} b
 * @param {number} at
 */
export function ac3At(b, at) {
  if (b[at] !== 0x0b || b[at + 1] !== 0x77) return null;
  const bsid = (b[at + 5] ?? 0) >> 3;
  const c = new Bits(b.subarray(at + 2, at + 16));
  if (bsid <= 10) {
    c.bits(16);
    const fscod = c.bits(2);
    const frmsizecod = c.bits(6);
    c.bits(5);
    const bsmod = c.bits(3);
    const acmod = c.bits(3);
    if (acmod & 1 && acmod !== 1) c.bits(2);
    if (acmod & 4) c.bits(2);
    if (acmod === 2) c.bits(2);
    const lfeon = c.bit();
    const rate = AC3_RATES[fscod];
    const kbps = AC3_KBPS[frmsizecod >> 1];
    if (!rate || !kbps) return null;
    const words = Math.floor((kbps * 1000 * 1536) / rate / 16) + (fscod === 1 ? frmsizecod & 1 : 0);
    return {
      eac3: false,
      length: words * 2,
      samples: 1536,
      rate,
      fscod,
      bsid,
      bsmod,
      acmod,
      lfeon,
      kbps,
      bitRateCode: frmsizecod >> 1,
    };
  }
  if (bsid > 16) return null;
  c.bits(5);
  const frmsiz = c.bits(11);
  const fscod = c.bits(2);
  const blocks = fscod === 3 ? 6 : ([1, 2, 3, 6][c.bits(2)] ?? 6);
  const rate = fscod === 3 ? [24000, 22050, 16000][c.bits(2)] : AC3_RATES[fscod];
  const acmod = c.bits(3);
  const lfeon = c.bit();
  if (!rate) return null;
  const length = (frmsiz + 1) * 2;
  const samples = 256 * blocks;
  const kbps = Math.round((length * 8 * rate) / samples / 1000);
  return {
    eac3: true,
    length,
    samples,
    rate,
    fscod: Math.min(fscod, 3),
    bsid,
    bsmod: 0,
    acmod,
    lfeon,
    kbps,
    bitRateCode: 0,
  };
}

/** The content of a dac3 or dec3 box for a stream whose first frame is `frame`. */
export function ac3Config(/** @type {NonNullable<ReturnType<typeof ac3At>>} */ f) {
  const w = new Writer();
  if (!f.eac3) {
    const bits =
      (f.fscod << 22) |
      (f.bsid << 17) |
      (f.bsmod << 14) |
      (f.acmod << 11) |
      (f.lfeon << 10) |
      (f.bitRateCode << 5);
    return w.u24(bits).done();
  }
  // One independent substream and no dependent ones.
  w.u16((f.kbps << 3) | 0);
  return w
    .u24((f.fscod << 22) | (f.bsid << 17) | (f.bsmod << 12) | (f.acmod << 9) | (f.lfeon << 8))
    .done();
}

const OPUS_MS = [10, 20, 40, 60];
const CELT_MS = [2.5, 5, 10, 20];

/** How many 48 kHz samples an Opus packet holds, from its TOC byte (RFC 6716 3.1). */
export function opusSamples(/** @type {Uint8Array} */ packet) {
  const toc = packet[0] ?? 0;
  const config = toc >> 3;
  const ms =
    config < 12 ? OPUS_MS[config & 3] : config < 16 ? (config & 1 ? 20 : 10) : CELT_MS[config & 3];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code < 3 ? 2 : (packet[1] ?? 0) & 0x3f;
  return Math.round((ms ?? 20) * 48 * frames);
}

/** The content of a dOps box from an OpusHead packet (RFC 7845 5.1, little-endian, to big-endian). */
export function dOps(/** @type {Uint8Array} */ head) {
  const c = new Cursor(head, 8, true);
  c.skip(1);
  const channels = c.u8();
  const preskip = c.u16();
  const rate = c.u32();
  const gain = c.i16();
  const family = c.u8();
  const w = new Writer()
    .u8(0)
    .u8(channels)
    .u16(preskip)
    .u32(rate)
    .u16(gain & 0xffff)
    .u8(family);
  if (family !== 0) w.put(head.subarray(19, 21 + channels));
  return { config: w.done(), channels, preskip };
}

const FLAC_SIZES = [
  0, 192, 576, 1152, 2304, 4608, 0, 0, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768,
];

/** A FLAC frame header's block size and coded number (RFC 9639 9.1). */
export function flacFrame(/** @type {Uint8Array} */ b) {
  if (b[0] !== 0xff || ((b[1] ?? 0) & 0xfe) !== 0xf8) return null;
  const variable = (b[1] ?? 0) & 1;
  const code = (b[2] ?? 0) >> 4;
  let at = 4;
  const first = b[at] ?? 0;
  let extra = 0;
  while (extra < 7 && first & (0x80 >> extra)) extra++;
  let number = extra === 0 ? first : first & (0x7f >> extra);
  for (let i = 1; i < extra; i++) number = number * 64 + ((b[at + i] ?? 0) & 0x3f);
  at += Math.max(1, extra);
  let size = FLAC_SIZES[code] ?? 0;
  if (code === 6) size = (b[at] ?? 0) + 1;
  if (code === 7) size = (((b[at] ?? 0) << 8) | (b[at + 1] ?? 0)) + 1;
  return size ? { size, number, variable: variable === 1 } : null;
}

/** STREAMINFO's facts (RFC 9639 8.2): block size, rate, channels, bits. */
export function streamInfo(/** @type {Uint8Array} */ info) {
  const c = new Bits(info);
  const minBlock = c.bits(16);
  c.bits(16 + 24 + 24);
  return { minBlock, rate: c.bits(20), channels: c.bits(3) + 1, bits: c.bits(5) + 1 };
}

/** The content of a dfLa box: version and flags, then STREAMINFO as the last metadata block. */
export const dfLa = (/** @type {Uint8Array} */ info) =>
  new Writer().u32(0).u8(0x80).u24(info.length).put(info).done();

/** The 34-byte STREAMINFO in a FLAC header ("fLaC" then blocks), or null. */
export function findStreamInfo(/** @type {Uint8Array} */ bytes) {
  for (let at = 0; at + 4 <= bytes.length; at++) {
    if (
      bytes[at] !== 0x66 ||
      bytes[at + 1] !== 0x4c ||
      bytes[at + 2] !== 0x61 ||
      bytes[at + 3] !== 0x43
    )
      continue;
    if (((bytes[at + 4] ?? 0) & 0x7f) === 0) return bytes.slice(at + 8, at + 8 + 34);
  }
  return null;
}
