// RIFF: AVI (the main header, each stream's header and format) and WAV (fmt, data, RF64's ds64),
// with their INFO tags and, in WAV, an id3 chunk. Chunks are walked by their headers; movi and data
// are never read.
import { Cursor, latin1, utf8OrLatin1 } from "../bytes.js";
import { fourccCodec, waveCodec } from "../codecs.js";
import { readId3v2 } from "./id3.js";

/**
 * @typedef {import("./index.js").Read} Read
 * @typedef {import("./index.js").Track} Track
 * @typedef {import("./index.js").Tags} Tags
 * @typedef {import("../source.js").Source} Source
 * @typedef {{ id: string, at: number, size: number, type?: string }} Chunk
 */

/** The chunks from `start` to `end`: id, where the content starts, its size, and a LIST's type. */
async function chunks(
  /** @type {Source} */ source,
  /** @type {number} */ start,
  /** @type {number} */ end,
) {
  /** @type {Chunk[]} */
  const out = [];
  for (let at = start; at + 8 <= end && out.length < 512; ) {
    const h = await source.read(at, 12);
    if (h.length < 8) break;
    const c = new Cursor(h, 4, true);
    const id = latin1(h.subarray(0, 4));
    const size = c.u32();
    /** @type {Chunk} */
    const chunk = { id, at: at + 8, size };
    if (id === "LIST" || id === "RIFF") chunk.type = latin1(h.subarray(8, 12));
    out.push(chunk);
    at += 8 + size + (size & 1);
  }
  return out;
}

/** INFO subchunks as tags. */
function infoTags(/** @type {Uint8Array} */ list) {
  /** @type {Tags} */
  const tags = {};
  const names = /** @type {Record<string, keyof Tags>} */ ({
    INAM: "title",
    IART: "artist",
    IPRD: "album",
    ICRD: "year",
    IGNR: "genre",
    ICMT: "comment",
    ITRK: "track",
    IPRT: "track",
  });
  const c = new Cursor(list, 4, true);
  while (c.left >= 8) {
    const id = c.ascii(4);
    const size = c.u32();
    const text = utf8OrLatin1(c.take(size)).replace(/\0+$/, "").trim();
    if (size & 1) c.skip(1);
    const key = names[id];
    if (key && text) tags[key] = key === "year" ? text.slice(0, 4) : text;
  }
  return tags;
}

/** A WAVEFORMATEX: the codec (WAVE_FORMAT_EXTENSIBLE names it in its subformat), channels, rate, bits. */
export function waveFormat(/** @type {Uint8Array} */ fmt) {
  const c = new Cursor(fmt, 0, true);
  let tag = c.u16();
  const channels = c.u16();
  const sampleRate = c.u32();
  const byteRate = c.u32();
  c.skip(2);
  const bits = c.u16();
  if (tag === 0xfffe && fmt.length >= 40) tag = new Cursor(fmt, 24, true).u16();
  return { tag, codec: waveCodec(tag), channels, sampleRate, byteRate, bits };
}

/** @type {Read} */
export async function readRiff(source, head) {
  const form = latin1(head.subarray(8, 12));
  const top = await chunks(source, 12, source.size);
  /** @type {Tags} */
  let tags = {};
  /** @type {import("./index.js").Picture | undefined} */
  let cover;
  for (const chunk of top) {
    if (chunk.id === "LIST" && chunk.type === "INFO")
      tags = { ...tags, ...infoTags(await source.read(chunk.at, Math.min(chunk.size, 1 << 20))) };
    if (chunk.id.toLowerCase() === "id3 ") {
      const id3 = readId3v2(await source.read(chunk.at, Math.min(chunk.size, 1 << 24)));
      tags = { ...id3.tags, ...tags };
      cover = id3.cover;
    }
  }
  if (form === "WAVE") return { ...(await readWave(source, head, top)), tags, cover };
  if (form !== "AVI ") throw new Error(`RIFF ${form.trim()} is not a form the player reads.`);
  const hdrl = top.find((c) => c.id === "LIST" && c.type === "hdrl");
  if (!hdrl) throw new Error("This AVI file has no header list (hdrl).");
  const inner = await chunks(source, hdrl.at + 4, hdrl.at + hdrl.size);
  const avih = inner.find((c) => c.id === "avih");
  let duration;
  let width;
  let height;
  if (avih) {
    const a = new Cursor(await source.read(avih.at, 56), 0, true);
    const usPerFrame = a.u32();
    a.skip(12);
    const frames = a.u32();
    a.skip(12);
    width = a.u32();
    height = a.u32();
    if (usPerFrame > 0) duration = (usPerFrame * frames) / 1e6;
  }
  /** @type {Track[]} */
  const tracks = [];
  for (const strl of inner.filter((c) => c.id === "LIST" && c.type === "strl")) {
    const parts = await chunks(source, strl.at + 4, strl.at + strl.size);
    const strh = parts.find((c) => c.id === "strh");
    const strf = parts.find((c) => c.id === "strf");
    if (!strh || !strf) continue;
    const h = await source.read(strh.at, 56);
    const kind = latin1(h.subarray(0, 4));
    const handler = latin1(h.subarray(4, 8));
    const s = new Cursor(h, 20, true);
    const scale = s.u32();
    const rate = s.u32();
    s.skip(4);
    const length = s.u32();
    if (rate > 0 && scale > 0) duration = Math.max(duration ?? 0, (length * scale) / rate);
    const f = await source.read(strf.at, Math.min(strf.size, 1024));
    if (kind === "vids") {
      const bih = new Cursor(f, 4, true);
      const w = bih.i32();
      const ht = Math.abs(bih.i32());
      bih.skip(4);
      const compression = latin1(f.subarray(16, 20));
      const fourcc = /^[\x20-\x7e]{4}$/.test(compression)
        ? compression
        : /^[\x20-\x7e]{4}$/.test(handler)
          ? handler
          : compression;
      tracks.push({
        kind: "video",
        codec: fourccCodec(fourcc),
        codecId: fourcc.trim(),
        width: w || width,
        height: ht || height,
      });
    } else if (kind === "auds") {
      const wave = waveFormat(f);
      /** @type {Track} */
      const track = {
        kind: "audio",
        codec: wave.codec,
        sampleRate: wave.sampleRate,
        channels: wave.channels,
      };
      if (wave.codec === "PCM") track.bits = wave.bits;
      tracks.push(track);
    } else if (kind === "txts") tracks.push({ kind: "subtitle", codec: "Text" });
  }
  return { duration, tracks, tags, cover };
}

/** WAV: fmt and data (RF64 and BW64 keep the data size in ds64). */
async function readWave(
  /** @type {Source} */ source,
  /** @type {Uint8Array} */ head,
  /** @type {Chunk[]} */ top,
) {
  const fmt = top.find((c) => c.id === "fmt ");
  if (!fmt) throw new Error("This WAV file has no format chunk.");
  const wave = waveFormat(await source.read(fmt.at, Math.min(fmt.size, 64)));
  const data = top.find((c) => c.id === "data");
  let bytes = data ? Math.min(data.size, source.size - data.at) : 0;
  const ds64 = top.find((c) => c.id === "ds64");
  if (ds64 && latin1(head.subarray(0, 4)) !== "RIFF") {
    const d = new Cursor(await source.read(ds64.at, 24), 8, true);
    bytes = Math.min(d.u64(), source.size - (data?.at ?? 0));
  }
  /** @type {Track} */
  const track = {
    kind: "audio",
    codec: wave.codec,
    channels: wave.channels,
    sampleRate: wave.sampleRate,
  };
  if (wave.codec === "PCM") track.bits = wave.bits;
  const duration = wave.byteRate > 0 ? bytes / wave.byteRate : undefined;
  return { duration, tracks: [track] };
}
