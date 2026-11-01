// ISO base media boxes (MP4, QuickTime, 3GP): the walk over a file's boxes through a ranged source,
// and the codec strings (RFC 6381) the sample entries' configuration boxes give canPlayType.
import { Cursor, latin1 } from "../bytes.js";

/**
 * @typedef {{ type: string, at: number, size: number, header: number, end: number }} Box
 * @typedef {import("../source.js").Source} Source
 */

/**
 * The boxes in [start, end) of the source, by their headers only.
 * @param {Source} source
 * @param {number} start
 * @param {number} end
 * @returns {Promise<Box[]>}
 */
export async function boxes(source, start, end) {
  /** @type {Box[]} */
  const out = [];
  let at = start;
  while (at + 8 <= end && out.length < 4096) {
    const head = await source.read(at, 16);
    if (head.length < 8) break;
    const box = boxAt(head, 0, end - at);
    if (!box) break;
    out.push({ ...box, at: at + box.at, end: at + box.end });
    at += box.size;
  }
  return out;
}

/**
 * The box whose header starts at `at` in `bytes`; `room` is how far its parent reaches from there.
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} room
 * @returns {Box | null}
 */
export function boxAt(bytes, at, room) {
  if (at + 8 > bytes.length) return null;
  const c = new Cursor(bytes, at);
  let size = c.u32();
  const type = latin1(c.take(4));
  let header = 8;
  if (size === 1) {
    if (at + 16 > bytes.length) return null;
    size = c.u64();
    header = 16;
  } else if (size === 0) size = room;
  if (size < header) return null;
  // A box that claims more than its parent holds is cut to it (a file cut short, a muxer's slip).
  size = Math.min(size, room);
  return { type, at, size, header, end: at + size };
}

/**
 * The boxes inside bytes already read, from `start` to `end`.
 * @param {Uint8Array} bytes
 * @param {number} [start]
 * @param {number} [end]
 */
export function boxesIn(bytes, start = 0, end = bytes.length) {
  /** @type {Box[]} */
  const out = [];
  for (let at = start; at + 8 <= end && out.length < 1024; ) {
    const box = boxAt(bytes, at, end - at);
    if (!box) break;
    out.push(box);
    at = box.end;
  }
  return out;
}

/** A box's content, without its header. */
export const contentOf = (/** @type {Source} */ source, /** @type {Box} */ box, max = 1 << 24) =>
  source.read(box.at + box.header, Math.min(max, box.size - box.header));

/** Two hex digits. */
const hex = (/** @type {number} */ n) => n.toString(16).toUpperCase().padStart(2, "0");
const two = (/** @type {number} */ n) => String(n).padStart(2, "0");

/** avc1.PPCCLL from an avcC box's content. */
export function avcCodec(/** @type {string} */ type, /** @type {Uint8Array} */ avcC) {
  return `${type}.${hex(avcC[1] ?? 0)}${hex(avcC[2] ?? 0)}${hex(avcC[3] ?? 0)}`;
}

/** hvc1.<space+profile>.<compat>.<tier+level>[.<constraints>] from an hvcC box's content. */
export function hevcCodec(/** @type {string} */ type, /** @type {Uint8Array} */ hvcC) {
  const c = new Cursor(hvcC, 1);
  const first = c.u8();
  const space = ["", "A", "B", "C"][first >> 6] ?? "";
  const tier = first & 0x20 ? "H" : "L";
  const profile = first & 0x1f;
  let compat = c.u32();
  let reversed = 0;
  for (let i = 0; i < 32; i++) {
    reversed = (reversed << 1) | (compat & 1);
    compat >>>= 1;
  }
  const constraints = [...c.take(6)];
  while (constraints.length > 0 && constraints.at(-1) === 0) constraints.pop();
  const level = c.u8();
  const tail = constraints.map((b) => `.${b.toString(16).toUpperCase()}`).join("");
  return `${type}.${space}${profile}.${(reversed >>> 0).toString(16).toUpperCase()}.${tier}${level}${tail}`;
}

/** vp09.PP.LL.DD from a vpcC box's content (a full box). */
export function vp9Codec(/** @type {Uint8Array} */ vpcC) {
  const c = new Cursor(vpcC, 4);
  const profile = c.u8();
  const level = c.u8();
  const depth = c.u8() >> 4;
  return `vp09.${two(profile)}.${two(level)}.${two(depth)}`;
}

/** av01.P.LLT.DD from an av1C box's content. */
export function av1Codec(/** @type {Uint8Array} */ av1C) {
  const b1 = av1C[1] ?? 0;
  const b2 = av1C[2] ?? 0;
  const depth = b2 & 0x20 ? 12 : b2 & 0x40 ? 10 : 8;
  return `av01.${b1 >> 5}.${two(b1 & 0x1f)}${b2 & 0x80 ? "H" : "M"}.${two(depth)}`;
}

/** An MPEG-4 descriptor's length: one to four bytes of seven bits. */
function descriptorLength(/** @type {Cursor} */ c) {
  let length = 0;
  for (let i = 0; i < 4; i++) {
    const b = c.u8();
    length = (length << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return length;
}

const AAC_TYPES = {
  1: "AAC Main",
  2: "AAC",
  5: "HE-AAC",
  23: "AAC-LD",
  29: "HE-AAC v2",
  39: "AAC-ELD",
};
const OBJECT_TYPES = {
  32: "MPEG-4 Part 2",
  33: "H.264",
  96: "MPEG-2 Video",
  97: "MPEG-2 Video",
  98: "MPEG-2 Video",
  99: "MPEG-2 Video",
  100: "MPEG-2 Video",
  101: "MPEG-2 Video",
  106: "MPEG-1 Video",
  108: "Motion JPEG",
  105: "MP3",
  107: "MP3",
  165: "AC-3",
  166: "E-AC-3",
  169: "DTS",
  221: "Vorbis",
  173: "Opus",
};

/**
 * The codec an esds box names: its object type, and for AAC the audio object type.
 * @param {Uint8Array} esds the box's content (a full box)
 * @returns {{ codec: string, codecId: string } | null}
 */
export function esdsCodec(esds) {
  const c = new Cursor(esds, 4);
  if (c.u8() !== 0x03) return null;
  descriptorLength(c);
  c.skip(2);
  const flags = c.u8();
  if (flags & 0x80) c.skip(2);
  if (flags & 0x40) c.skip(c.u8());
  if (flags & 0x20) c.skip(2);
  if (c.u8() !== 0x04) return null;
  descriptorLength(c);
  const oti = c.u8();
  c.skip(12);
  const id = `mp4a.${oti.toString(16).toUpperCase()}`;
  const aacFamily = [0x40, 0x66, 0x67, 0x68].includes(oti);
  if (!aacFamily) {
    const codec = /** @type {Record<number, string>} */ (OBJECT_TYPES)[oti] ?? `object type ${oti}`;
    return { codec, codecId: oti === 0x6b || oti === 0x69 ? "mp3" : id };
  }
  let aot = 2;
  if (c.u8() === 0x05) {
    descriptorLength(c);
    const b0 = c.u8();
    const b1 = c.u8();
    aot = b0 >> 3;
    if (aot === 31) aot = 32 + (((b0 & 7) << 3) | (b1 >> 5));
  }
  const codec = /** @type {Record<number, string>} */ (AAC_TYPES)[aot] ?? "AAC";
  return { codec, codecId: `mp4a.40.${aot}` };
}
