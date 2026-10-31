// AIFF and AIFF-C (COMM, the text chunks and an ID3 chunk) and Apple's CAF (desc, pakt, data and
// info). Chunks are walked by their headers; the sound data is never read.
import { Cursor, latin1, utf8 } from "../bytes.js";
import { mp4Codec } from "../codecs.js";
import { readId3v2 } from "./id3.js";

/**
 * @typedef {import("./index.js").Read} Read
 * @typedef {import("./index.js").Track} Track
 * @typedef {import("./index.js").Tags} Tags
 */

/** An IEEE 754 80-bit extended number, as AIFF writes the sample rate. */
function extended(/** @type {Uint8Array} */ b, /** @type {number} */ at) {
  const c = new Cursor(b, at);
  const top = c.u16();
  const high = c.u32();
  const low = c.u32();
  if (top === 0 && high === 0 && low === 0) return 0;
  const exponent = (top & 0x7fff) - 16383 - 63;
  const value = (high * 2 ** 32 + low) * 2 ** exponent;
  return top & 0x8000 ? -value : value;
}

const AIFC = /** @type {Record<string, string>} */ ({
  NONE: "PCM",
  none: "PCM",
  sowt: "PCM",
  twos: "PCM",
  fl32: "PCM",
  FL32: "PCM",
  fl64: "PCM",
  FL64: "PCM",
  in24: "PCM",
  in32: "PCM",
  alaw: "A-law",
  ALAW: "A-law",
  ulaw: "μ-law",
  ULAW: "μ-law",
  ima4: "IMA ADPCM",
  MAC3: "MACE 3:1",
  MAC6: "MACE 6:1",
  GSM: "GSM 6.10",
  QDM2: "QDesign Music 2",
});

/** @type {Read} */
export async function readAiff(source, head) {
  const compressed = latin1(head.subarray(8, 12)) === "AIFC";
  /** @type {Tags} */
  let tags = {};
  /** @type {import("./index.js").Picture | undefined} */
  let cover;
  /** @type {Track | undefined} */
  let track;
  let duration;
  for (let at = 12, n = 0; at + 8 <= source.size && n < 256; n++) {
    const h = await source.read(at, 8);
    const id = latin1(h.subarray(0, 4));
    const size = new Cursor(h, 4).u32();
    if (id === "COMM") {
      const b = await source.read(at + 8, Math.min(size, 256));
      const c = new Cursor(b);
      const channels = c.u16();
      const frames = c.u32();
      const bits = c.u16();
      const rate = extended(b, 8);
      const type = compressed ? latin1(b.subarray(18, 22)) : "NONE";
      const codec = AIFC[type] ?? AIFC[type.trim()] ?? type.trim();
      track = { kind: "audio", codec, channels, sampleRate: rate };
      if (codec === "PCM")
        track.bits =
          type.startsWith("fl") || type.startsWith("FL") ? (type.endsWith("64") ? 64 : 32) : bits;
      if (rate > 0) duration = frames / rate;
    } else if (id === "NAME" || id === "AUTH" || id === "ANNO") {
      const text = latin1(await source.read(at + 8, Math.min(size, 4096)))
        .replace(/\0+$/, "")
        .trim();
      const key = id === "NAME" ? "title" : id === "AUTH" ? "artist" : "comment";
      if (text && !tags[key]) tags[key] = text;
    } else if (id === "ID3 " || id === "id3 ") {
      const id3 = readId3v2(await source.read(at + 8, Math.min(size, 1 << 24)));
      tags = { ...tags, ...id3.tags };
      cover = id3.cover;
    }
    at += 8 + size + (size & 1);
  }
  if (!track) throw new Error("This AIFF file has no COMM chunk.");
  return { duration, tracks: [track], tags, cover };
}

const CAF_TAGS = /** @type {Record<string, keyof Tags>} */ ({
  title: "title",
  artist: "artist",
  album: "album",
  year: "year",
  genre: "genre",
  comments: "comment",
  "track number": "track",
});

/** @type {Read} */
export async function readCaf(source) {
  /** @type {Track | undefined} */
  let track;
  /** @type {Tags} */
  const tags = {};
  let rate = 0;
  let bytesPerPacket = 0;
  let framesPerPacket = 0;
  let validFrames = 0;
  let dataBytes = 0;
  for (let at = 8, n = 0; at + 12 <= source.size && n < 256; n++) {
    const h = new Cursor(await source.read(at, 12));
    const type = h.ascii(4);
    let size = h.u64();
    if (size === 2 ** 64 - 1 || size > source.size) size = source.size - at - 12;
    if (type === "desc") {
      const c = new Cursor(await source.read(at + 12, 32));
      rate = c.f64();
      const format = c.ascii(4);
      c.skip(4);
      bytesPerPacket = c.u32();
      framesPerPacket = c.u32();
      const channels = c.u32();
      const bits = c.u32();
      const codec = format === "aac " ? "AAC" : mp4Codec(format);
      track = { kind: "audio", codec, channels, sampleRate: rate };
      if (codec === "PCM" || codec === "Apple Lossless") track.bits = bits || undefined;
    } else if (type === "pakt") {
      const c = new Cursor(await source.read(at + 12, 16));
      c.skip(8);
      validFrames = c.u64();
    } else if (type === "data") dataBytes = Math.max(0, size - 4);
    else if (type === "info") {
      const b = await source.read(at + 12, Math.min(size, 1 << 20));
      const parts = utf8(b.subarray(4)).split("\0");
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const key = CAF_TAGS[(parts[i] ?? "").toLowerCase()];
        if (key && parts[i + 1]) tags[key] = parts[i + 1];
      }
    }
    at += 12 + size;
  }
  if (!track) throw new Error("This CAF file has no description chunk.");
  let duration;
  if (validFrames > 0 && rate > 0) duration = validFrames / rate;
  else if (bytesPerPacket > 0 && framesPerPacket > 0 && rate > 0)
    duration = ((dataBytes / bytesPerPacket) * framesPerPacket) / rate;
  return { duration, tracks: [track], tags };
}
