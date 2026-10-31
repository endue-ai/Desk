// Ogg: each logical stream's identification header (Vorbis, Opus, Theora, FLAC, Speex), its comment
// header with the tags and METADATA_BLOCK_PICTURE, and the duration from the last page's granule
// position. Packets are put back together from the pages' segments.
import { Cursor, startsWith } from "../bytes.js";
import { streamInfo } from "./flac.js";
import { flacPicture, vorbisComments } from "./vorbis.js";

/**
 * @typedef {import("./index.js").Read} Read
 * @typedef {import("./index.js").Track} Track
 * @typedef {{ track: Track, rate: number, preskip: number, shift: number, packets: Uint8Array[],
 *   partial: number[], comments?: ReturnType<typeof vorbisComments> }} Stream
 */

/** The pages in bytes: header type, granule position, serial number, segment sizes and data. */
function* pages(/** @type {Uint8Array} */ b) {
  for (let at = 0; at + 27 <= b.length; ) {
    if (!startsWith(b, "OggS", at)) {
      const next = b.indexOf(0x4f, at + 1);
      if (next < 0) return;
      at = next;
      continue;
    }
    const c = new Cursor(b, at + 5, true);
    const type = c.u8();
    const low = c.u32();
    const high = c.i32();
    const serial = c.u32();
    const count = b[at + 26] ?? 0;
    const segments = [...b.subarray(at + 27, at + 27 + count)];
    const start = at + 27 + count;
    const length = segments.reduce((sum, n) => sum + n, 0);
    if (start + length > b.length) return;
    yield {
      type,
      granule: high * 2 ** 32 + low,
      serial,
      segments,
      data: b.subarray(start, start + length),
    };
    at = start + length;
  }
}

/** A stream's identification header as a track and its clock. */
function identify(/** @type {Uint8Array} */ p) {
  const c = new Cursor(p, 0, true);
  if (startsWith(p, "\x01vorbis")) {
    c.skip(11);
    const channels = c.u8();
    const rate = c.u32();
    return {
      track: { kind: "audio", codec: "Vorbis", codecId: "vorbis", channels, sampleRate: rate },
      rate,
      preskip: 0,
      shift: 0,
    };
  }
  if (startsWith(p, "OpusHead")) {
    c.skip(9);
    const channels = c.u8();
    const preskip = c.u16();
    return {
      track: { kind: "audio", codec: "Opus", codecId: "opus", channels, sampleRate: 48000 },
      rate: 48000,
      preskip,
      shift: 0,
    };
  }
  if (startsWith(p, "\x80theora")) {
    const t = new Cursor(p, 14);
    const width = t.u24();
    const height = t.u24();
    t.skip(2);
    const fps = t.u32() / (t.u32() || 1);
    const shift = (((p[40] ?? 0) & 3) << 3) | ((p[41] ?? 0) >> 5);
    return {
      track: { kind: "video", codec: "Theora", codecId: "theora", width, height },
      rate: fps,
      preskip: 0,
      shift,
    };
  }
  if (startsWith(p, "\x7fFLAC") && startsWith(p, "fLaC", 9)) {
    const info = streamInfo(p.subarray(17));
    const track = {
      kind: "audio",
      codec: "FLAC",
      codecId: "flac",
      channels: info.channels,
      sampleRate: info.rate,
      bits: info.bits,
    };
    return { track, rate: info.rate, preskip: 0, shift: 0 };
  }
  if (startsWith(p, "Speex   ")) {
    const s = new Cursor(p, 36, true);
    const rate = s.u32();
    s.skip(8);
    return {
      track: { kind: "audio", codec: "Speex", sampleRate: rate, channels: s.u32() },
      rate,
      preskip: 0,
      shift: 0,
    };
  }
  if (startsWith(p, "OVP80"))
    return { track: { kind: "video", codec: "VP8" }, rate: 0, preskip: 0, shift: 0 };
  return null;
}

/** The tags in a stream's comment packet, by codec. */
function commentsOf(/** @type {Track} */ track, /** @type {Uint8Array} */ p) {
  if (track.codec === "Vorbis" && startsWith(p, "\x03vorbis")) return vorbisComments(p.subarray(7));
  if (track.codec === "Opus" && startsWith(p, "OpusTags")) return vorbisComments(p.subarray(8));
  if (track.codec === "Theora" && startsWith(p, "\x81theora")) return vorbisComments(p.subarray(7));
  if (track.codec === "Speex") return vorbisComments(p);
  if (track.codec === "FLAC" && ((p[0] ?? 0) & 0x7f) === 4) return vorbisComments(p.subarray(4));
  return undefined;
}

/** Read the streams' first packets from the start of the file. */
function streamsIn(/** @type {Uint8Array} */ b) {
  /** @type {Map<number, Stream>} */
  const streams = new Map();
  for (const page of pages(b)) {
    let stream = streams.get(page.serial);
    if (!stream && page.type & 2) {
      let length = 0;
      for (const size of page.segments) {
        length += size;
        if (size < 255) break;
      }
      const found = identify(page.data.subarray(0, length));
      if (!found) continue;
      stream = { ...found, track: /** @type {Track} */ (found.track), packets: [], partial: [] };
      streams.set(page.serial, stream);
    }
    if (!stream || stream.packets.length >= 8) continue;
    let at = 0;
    for (const size of page.segments) {
      stream.partial.push(...page.data.subarray(at, at + size));
      at += size;
      if (size < 255) {
        stream.packets.push(Uint8Array.from(stream.partial));
        stream.partial = [];
      }
    }
  }
  return streams;
}

/** @type {Read} */
export async function readOgg(source) {
  let window = 256 * 1024;
  let streams = streamsIn(await source.read(0, window));
  // A comment packet with a large picture spans many pages: read on until it is whole.
  while (
    window < source.size &&
    window < 1 << 24 &&
    [...streams.values()].some((s) => s.packets.length < 2)
  ) {
    window *= 4;
    streams = streamsIn(await source.read(0, window));
  }
  if (streams.size === 0) throw new Error("No Ogg stream here has a codec the player knows.");
  /** @type {import("./index.js").Tags} */
  let tags = {};
  /** @type {import("./index.js").Picture | undefined} */
  let cover;
  for (const stream of streams.values()) {
    for (const packet of stream.packets.slice(1)) {
      if (stream.track.codec === "FLAC" && ((packet[0] ?? 0) & 0x7f) === 6) {
        const picture = flacPicture(packet.subarray(4));
        if (picture && !cover) cover = { type: picture.type, bytes: picture.bytes };
      }
      const found = commentsOf(stream.track, packet);
      if (!found) continue;
      tags = { ...found.tags, ...tags };
      cover = cover ?? found.cover;
      if (stream.track.codec !== "FLAC") break;
    }
  }
  const tail = await source.read(Math.max(0, source.size - 256 * 1024), 256 * 1024);
  let duration = 0;
  for (const page of pages(tail)) {
    const stream = streams.get(page.serial);
    if (!stream || page.granule < 0 || !stream.rate) continue;
    let units = page.granule;
    if (stream.shift > 0) {
      const key = Math.floor(page.granule / 2 ** stream.shift);
      units = key + (page.granule - key * 2 ** stream.shift);
    }
    duration = Math.max(duration, (units - stream.preskip) / stream.rate);
  }
  const tracks = [...streams.values()].map((s) => s.track);
  tracks.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "video" ? -1 : 1));
  return { duration: duration || undefined, tracks, tags, cover };
}
