// The AVI demuxer (Microsoft AVI RIFF and OpenDML 1.02): stream headers and formats from hdrl, the
// chunks of each stream from the OpenDML indexes (indx, ix##) or idx1, timed by the stream's rate:
// one video frame a chunk, audio by chunk or by bytes. H.264 arrives as Annex B without times, so
// each frame's picture order count (nal.js) gives the presentation order.
import { ascii, Cursor, latin1 } from "../bytes.js";
import { fourccCodec } from "../codecs.js";
import { frameAt } from "../probe/mp3.js";
import { waveFormat } from "../probe/riff.js";
import { ac3At, adtsAt } from "./audio.js";
import {
  avcType,
  isAnnexB,
  pictureOrder,
  readAvcC,
  readSps,
  splitAnnexB,
  splitPrefixed,
} from "./nal.js";
import { PART, Reader } from "./reader.js";

/**
 * @typedef {import("./reader.js").Source} Source
 * @typedef {import("./config.js").DemuxTrack} DemuxTrack
 * @typedef {import("./timing.js").Packet} Packet
 * @typedef {{ pos: number, size: number, key: boolean, time: number }} Entry data position; time in ticks
 * @typedef {DemuxTrack & { entries: Entry[], sampleSize: number, scale: number, start: number, framed?: "mp3" | "ac3" | "adts" }} Stream
 */

const H264 = ["H264", "X264", "AVC1", "DAVC", "VSSH"];
const HEVC = ["HEVC", "H265", "HVC1", "HEV1"];
const AUDIO = /** @type {Record<number, string>} */ ({
  85: "MP3",
  80: "MP2",
  255: "AAC",
  5632: "AAC",
  5648: "AAC",
  28781: "AAC",
  8192: "AC-3",
  1: "PCM",
  3: "PCM (float)",
});

async function readAll(
  /** @type {Source} */ source,
  /** @type {number} */ at,
  /** @type {number} */ size,
) {
  const parts = [];
  for (let done = 0; done < size; ) {
    const part = await source.read(at + done, Math.min(PART, size - done));
    if (part.length === 0) break;
    parts.push(part);
    done += part.length;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Chunks inside bytes: id, data offset, size (RIFF pads odd sizes). */
function chunks(/** @type {Uint8Array} */ b, start = 0, end = b.length) {
  const out = [];
  for (let at = start; at + 8 <= end; ) {
    const id = ascii(b.subarray(at, at + 4));
    const size = new DataView(b.buffer, b.byteOffset + at + 4, 4).getUint32(0, true);
    const list = id === "LIST" ? ascii(b.subarray(at + 8, at + 12)) : "";
    out.push({ id, list, at: at + 8, size, end: Math.min(end, at + 8 + size) });
    at += 8 + size + (size & 1);
  }
  return out;
}

/** One strl list as a stream. */
function streamOf(
  /** @type {Uint8Array} */ b,
  /** @type {ReturnType<typeof chunks>[number]} */ strl,
  /** @type {number} */ index,
) {
  const parts = chunks(b, strl.at + 4, strl.end);
  const strh = parts.find((p) => p.id === "strh");
  const strf = parts.find((p) => p.id === "strf");
  if (!strh || !strf) return null;
  const h = new Cursor(b, strh.at, true);
  const type = h.ascii(4);
  const handler = h.ascii(4);
  h.skip(12);
  const scale = h.u32() || 1;
  const rate = h.u32() || 1;
  const start = h.u32();
  h.skip(8);
  h.skip(4);
  const sampleSize = h.u32();
  const f = b.subarray(strf.at, strf.end);
  /** @type {Stream} */
  const s = {
    id: index,
    kind: "audio",
    codec: "",
    timescale: rate,
    scale,
    start,
    sampleSize,
    entries: [],
  };
  const indx = parts.find((p) => p.id === "indx");
  if (indx) /** @type {Stream & { indx?: Uint8Array }} */ (s).indx = b.slice(indx.at, indx.end);
  if (type === "vids") {
    const c = new Cursor(f, 4, true);
    s.kind = "video";
    s.width = Math.abs(c.i32());
    s.height = Math.abs(c.i32());
    c.skip(4);
    const fourcc = latin1(f.subarray(16, 20));
    const id = (fourcc.trim() || handler).toUpperCase();
    s.codec = H264.includes(id) ? "H.264" : HEVC.includes(id) ? "HEVC" : fourccCodec(fourcc);
    s.frameDuration = scale;
    if (f.length > 40) s.config = f.slice(40);
    return s;
  }
  if (type !== "auds") return null;
  const wave = waveFormat(f);
  s.codec = AUDIO[wave.tag] ?? wave.codec;
  s.channels = wave.channels;
  s.sampleRate = wave.sampleRate;
  s.bits = wave.bits;
  s.little = true;
  if (s.codec === "PCM" && wave.bits === 8) s.codec = "PCM (8-bit unsigned)";
  const extra = f.length > 18 ? f.slice(18, 18 + new Cursor(f, 16, true).u16()) : new Uint8Array(0);
  if (s.codec === "AAC" && extra.length >= 2 && wave.tag !== 0x1600) s.config = extra;
  else if (s.codec === "AAC") s.framed = "adts";
  if (s.codec === "MP3") s.framed = "mp3";
  if (s.codec === "AC-3") s.framed = "ac3";
  return s;
}

/** The chunk ids a stream's data uses: "00dc", "01wb"... */
const owner = (/** @type {string} */ id) => {
  const n = Number.parseInt(id.slice(0, 2), 16);
  return Number.isNaN(n) || !/^(dc|db|wb)$/.test(id.slice(2)) ? -1 : n;
};

/** Every stream's chunks from the OpenDML standard indexes its super index points to. */
async function openDml(
  /** @type {Source} */ source,
  /** @type {Stream & { indx?: Uint8Array }} */ s,
) {
  const x = s.indx;
  if (!x || x.length < 24 || x[3] !== 0) return false;
  const c = new Cursor(x, 4, true);
  const count = c.u32();
  c.skip(16);
  for (let i = 0; i < count; i++) {
    const at = c.u64();
    const size = c.u32();
    c.skip(4);
    const ix = await readAll(source, at + 8, Math.min(size, 1 << 26));
    const d = new Cursor(ix, 4, true);
    const n = d.u32();
    d.skip(4);
    const base = d.u64();
    d.skip(4);
    for (let j = 0; j < n; j++) {
      const offset = d.u32();
      const length = d.u32();
      s.entries.push({
        pos: base + offset,
        size: length & 0x7fffffff,
        key: !(length & 0x80000000),
        time: 0,
      });
    }
  }
  return s.entries.length > 0;
}

/** Each stream's chunks from idx1, whose offsets count from 'movi' (or from the file's start). */
function legacy(
  /** @type {Uint8Array} */ idx1,
  /** @type {Stream[]} */ streams,
  /** @type {number} */ movi,
  /** @type {Uint8Array} */ probe,
) {
  const c = new Cursor(idx1, 0, true);
  const absolute = idx1.length >= 16 && ascii(probe.subarray(0, 4)) !== ascii(idx1.subarray(0, 4));
  for (let at = 0; at + 16 <= idx1.length; at += 16) {
    c.pos = at;
    const id = c.ascii(4);
    const flags = c.u32();
    const offset = c.u32();
    const size = c.u32();
    const s = streams.find((t) => t.id === owner(id));
    if (!s || s.entries === undefined) continue;
    s.entries.push({
      pos: (absolute ? offset : movi + offset) + 8,
      size,
      key: (flags & 0x10) !== 0,
      time: 0,
    });
  }
}

/**
 * Times in the stream's ticks: a frame or a block a chunk, or bytes over the sample size. An empty
 * video chunk is a dropped frame and takes its time; an empty audio chunk takes none.
 */
function time(/** @type {Stream} */ s) {
  if (s.kind === "audio") s.entries = s.entries.filter((e) => e.size > 0);
  let bytes = 0;
  s.entries.forEach((e, i) => {
    e.time =
      s.kind === "video" || s.sampleSize === 0
        ? (s.start + i) * s.scale
        : s.start * s.scale + Math.floor(bytes / s.sampleSize) * s.scale;
    bytes += e.size;
  });
  if (s.kind === "video") s.entries = s.entries.filter((e) => e.size > 0);
}

/** @param {Source} source */
export async function openAvi(source) {
  const head = await source.read(0, 12);
  if (ascii(head.subarray(0, 4)) !== "RIFF" || ascii(head.subarray(8, 12)) !== "AVI ")
    throw new Error("This AVI file has no RIFF header.");
  /** @type {Stream[]} */
  let streams = [];
  let movi = -1;
  /** @type {Uint8Array | null} */
  let idx1 = null;
  let duration = 0;
  const riffEnd = Math.min(
    source.size,
    8 + new DataView(head.buffer, head.byteOffset + 4, 4).getUint32(0, true),
  );
  for (let at = 12, n = 0; at + 8 <= riffEnd && n < 256; n++) {
    const h = await source.read(at, 12);
    const id = ascii(h.subarray(0, 4));
    const size = new DataView(h.buffer, h.byteOffset + 4, 4).getUint32(0, true);
    const list = ascii(h.subarray(8, 12));
    if (id === "LIST" && list === "hdrl") {
      const b = await readAll(source, at, 8 + size);
      const lists = chunks(b, 12).filter((c) => c.id === "LIST" && c.list === "strl");
      streams = lists.map((l, i) => streamOf(b, l, i)).filter((s) => s !== null);
      const avih = chunks(b, 12).find((c) => c.id === "avih");
      if (avih) {
        const c = new Cursor(b, avih.at, true);
        const micro = c.u32();
        c.skip(12);
        duration = (c.u32() * micro) / 1e6;
      }
    } else if (id === "LIST" && list === "movi") {
      movi = at + 8;
    } else if (id === "idx1") idx1 = await readAll(source, at + 8, Math.min(size, 1 << 26));
    at += 8 + size + (size & 1);
  }
  if (movi < 0 || streams.length === 0)
    throw new Error("This AVI file has no streams or no movie data.");
  let indexed = false;
  for (const s of streams) indexed = (await openDml(source, s)) || indexed;
  if (!indexed && idx1) legacy(idx1, streams, movi, await source.read(movi + 4, 4));
  for (const s of streams) time(s);
  const video = streams.find((s) => s.kind === "video");
  if (video && video.entries.length > 0) {
    const last = video.entries.at(-1);
    duration = Math.max(duration, ((last?.time ?? 0) + video.scale) / video.timescale);
  }
  if (streams.every((s) => s.entries.length === 0))
    throw new Error("This AVI file has no index, so the player cannot remux it.");

  /** @param {number} from @param {Set<number>} want @returns {AsyncGenerator<Packet>} */
  async function* packets(from, want) {
    const mine = streams.filter((s) => want.has(s.id));
    const lead = mine.find((s) => s.kind === "video") ?? mine[0];
    if (!lead) return;
    const target = from * lead.timescale;
    let start = lead.entries[0]?.pos ?? movi;
    for (const e of lead.entries)
      if ((lead.kind === "audio" || e.key) && e.time <= target + 1e-6 * lead.timescale)
        start = e.pos;
    const merged = mine.flatMap((s) =>
      s.entries.filter((e) => e.pos >= start).map((e) => ({ s, e })),
    );
    merged.sort((a, b) => a.e.pos - b.e.pos);
    const r = new Reader(source, start);
    /** @type {Map<number, { carry: Uint8Array, fresh: boolean }>} */
    const audio = new Map(mine.map((s) => [s.id, { carry: new Uint8Array(0), fresh: true }]));
    const poc = { msb: 0, lsb: 0, epoch: 0, count: 0 };
    /** @type {ReturnType<typeof readSps> | null} */
    let sps = null;
    if (video?.config && video.codec === "H.264") {
      const set = (
        video.config[0] === 1 ? readAvcC(video.config).sets : splitAnnexB(video.config)
      ).find((n) => avcType(n) === 7);
      if (set) sps = readSps(set);
    }
    for (const { s, e } of merged) {
      r.seek(e.pos);
      const data = await r.take(e.size);
      if (s.kind === "video") {
        /** @type {Packet} */
        const p = { track: s.id, dts: e.time, key: e.key, data };
        if (s.codec === "H.264") {
          const nals = isAnnexB(data) ? splitAnnexB(data) : splitPrefixed(data);
          const set = nals.find((n) => avcType(n) === 7);
          if (set) sps = readSps(set);
          if (nals.some((n) => avcType(n) === 5)) p.key = true;
          if (sps) p.order = pictureOrder(nals, sps, poc);
        }
        yield p;
        continue;
      }
      const state = audio.get(s.id);
      if (!s.framed || !state) {
        yield { track: s.id, pts: e.time, key: true, data };
        continue;
      }
      // Frames inside the chunk; a frame cut by the chunk's end waits for the next chunk.
      const joined = new Uint8Array(state.carry.length + data.length);
      joined.set(state.carry);
      joined.set(data, state.carry.length);
      let at = 0;
      let first = state.carry.length === 0;
      while (at + 7 <= joined.length) {
        const length = frameLength(s.framed, joined, at);
        if (!length) {
          at++;
          first = false;
          continue;
        }
        if (at + length > joined.length) break;
        /** @type {Packet} */
        const p = { track: s.id, key: true, data: joined.subarray(at, at + length) };
        if ((first && at === 0) || state.fresh) p.pts = e.time;
        state.fresh = false;
        first = false;
        yield p;
        at += length;
      }
      state.carry = joined.slice(at);
    }
  }

  return {
    duration,
    tracks: streams.map(({ entries, ...t }) => t),
    packets,
    async keyframe(/** @type {number} */ t) {
      const lead = video ?? streams[0];
      if (!lead) return 0;
      let best = 0;
      for (const e of lead.entries)
        if ((lead.kind === "audio" || e.key) && e.time <= (t + 1e-6) * lead.timescale)
          best = e.time;
      return best / lead.timescale;
    },
  };
}

/** The length of the frame at `at` in an MP3, AC-3 or ADTS stream, or 0 when none starts there. */
function frameLength(
  /** @type {"mp3" | "ac3" | "adts"} */ kind,
  /** @type {Uint8Array} */ b,
  /** @type {number} */ at,
) {
  if (kind === "mp3") return frameAt(b, at)?.length ?? 0;
  if (kind === "ac3") return ac3At(b, at)?.length ?? 0;
  return adtsAt(b, at)?.length ?? 0;
}
