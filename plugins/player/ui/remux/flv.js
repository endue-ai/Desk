// The FLV demuxer (Adobe FLV 10.1 Annex E, and Enhanced RTMP/FLV for hvc1 and av01): audio and video
// tags with their decode times in milliseconds and composition offsets, the AVC, HEVC or AV1 and AAC
// configurations from the sequence headers, and seeking by onMetaData's keyframes (or a tag scan).
import { Cursor, utf8 } from "../bytes.js";
import { frameAt } from "../probe/mp3.js";
import { Reader } from "./reader.js";

/**
 * @typedef {import("./reader.js").Source} Source
 * @typedef {import("./config.js").DemuxTrack} DemuxTrack
 * @typedef {import("./timing.js").Packet} Packet
 * @typedef {{ time: number, pos: number }} Key
 */

const VIDEO = 1;
const AUDIO = 2;
const LEGACY_VIDEO = /** @type {Record<number, string>} */ ({
  2: "Sorenson Spark",
  4: "VP6",
  5: "VP6",
  7: "H.264",
  12: "HEVC",
});
const FOURCC_VIDEO = /** @type {Record<string, string>} */ ({
  avc1: "H.264",
  hvc1: "HEVC",
  av01: "AV1",
  vp09: "VP9",
});
const LEGACY_AUDIO = /** @type {Record<number, string>} */ ({
  0: "PCM",
  1: "ADPCM",
  2: "MP3",
  3: "PCM",
  4: "Nellymoser",
  5: "Nellymoser",
  6: "Nellymoser",
  7: "A-law",
  8: "μ-law",
  10: "AAC",
  11: "Speex",
  14: "MP3",
});
const RATES = [5512, 11025, 22050, 44100];

/** One AMF0 value; objects and ECMA arrays become plain objects. */
function amf(/** @type {Cursor} */ c, depth = 0) {
  const type = c.u8();
  const string = () => utf8(c.take(c.u16()));
  const properties = () => {
    /** @type {Record<string, unknown>} */
    const out = {};
    while (c.left >= 3) {
      const key = string();
      if (key === "" && c.bytes[c.pos] === 9) {
        c.skip(1);
        break;
      }
      out[key] = amf(c, depth + 1);
    }
    return out;
  };
  if (depth > 16) return undefined;
  if (type === 0) return c.f64();
  if (type === 1) return c.u8() !== 0;
  if (type === 2) return string();
  if (type === 3) return properties();
  if (type === 8) {
    c.skip(4);
    return properties();
  }
  if (type === 10) {
    const n = c.u32();
    const items = [];
    for (let i = 0; i < n && c.left > 0; i++) items.push(amf(c, depth + 1));
    return items;
  }
  if (type === 11) {
    const t = c.f64();
    c.skip(2);
    return t;
  }
  return undefined;
}

/** Whether a video tag's first bytes say it is a key frame's picture (not a header or an end). */
function keyTag(/** @type {Uint8Array} */ d) {
  const b0 = d[0] ?? 0;
  if (b0 & 0x80) return ((b0 >> 4) & 7) === 1 && ((b0 & 0x0f) === 1 || (b0 & 0x0f) === 3);
  const id = b0 & 0x0f;
  return b0 >> 4 === 1 && (id === 7 || id === 12 ? d[1] === 1 : true);
}

/** A tag's header at the reader: type, size, time in ms; null at the end. */
async function tagAt(/** @type {Reader} */ r) {
  if ((await r.need(11)) < 11) return null;
  const c = new Cursor(r.peek(11));
  const type = c.u8() & 0x1f;
  const size = c.u24();
  const low = c.u24();
  const time = ((c.u8() << 24) | low) >>> 0;
  return { type, size, time: time > 0x7fffffff ? time - 2 ** 32 : time };
}

/** What a video tag holds: codec, packet type, composition offset, key flag, payload. */
function video(/** @type {Uint8Array} */ d) {
  const b0 = d[0] ?? 0;
  if (b0 & 0x80) {
    const fourcc = String.fromCharCode(...d.subarray(1, 5));
    const packet = b0 & 0x0f;
    const withCts = packet === 1 && fourcc !== "av01" && fourcc !== "vp09";
    const cts = withCts ? ((((d[5] ?? 0) << 16) | ((d[6] ?? 0) << 8) | (d[7] ?? 0)) << 8) >> 8 : 0;
    return {
      codec: FOURCC_VIDEO[fourcc] ?? fourcc,
      key: ((b0 >> 4) & 7) === 1,
      config: packet === 0,
      frame: packet === 1 || packet === 3,
      cts,
      data: d.subarray(withCts ? 8 : 5),
    };
  }
  const id = b0 & 0x0f;
  const codec = LEGACY_VIDEO[id] ?? `codec ${id}`;
  const key = b0 >> 4 === 1;
  if (id !== 7 && id !== 12)
    return { codec, key, config: false, frame: true, cts: 0, data: d.subarray(1) };
  const cts = ((((d[2] ?? 0) << 16) | ((d[3] ?? 0) << 8) | (d[4] ?? 0)) << 8) >> 8;
  return { codec, key, config: d[1] === 0, frame: d[1] === 1, cts, data: d.subarray(5) };
}

/** @param {Source} source */
export async function openFlv(source) {
  const head = await source.read(0, 9);
  if (head[0] !== 0x46 || head[1] !== 0x4c || head[2] !== 0x56)
    throw new Error("This Flash Video file has no FLV header.");
  const first = new Cursor(head, 5).u32() + 4;
  /** @type {Record<string, unknown>} */
  let meta = {};
  /** @type {DemuxTrack | undefined} */
  let v;
  /** @type {DemuxTrack | undefined} */
  let a;
  const r = new Reader(source, first);
  for (
    let n = 0;
    n < 400 && !(v?.config && a?.config !== undefined && Object.keys(meta).length);
    n++
  ) {
    const t = await tagAt(r);
    if (!t) break;
    r.skip(11);
    const d = await r.take(t.size);
    r.skip(4);
    if (t.type === 18 && Object.keys(meta).length === 0) {
      const c = new Cursor(d);
      if (amf(c) === "onMetaData") meta = /** @type {Record<string, unknown>} */ (amf(c) ?? {});
    } else if (t.type === 9 && d.length > 1) {
      const x = video(d);
      v ??= { id: VIDEO, kind: "video", codec: x.codec, timescale: 1000 };
      if (x.config && !v.config) v.config = d.slice(x.data.byteOffset - d.byteOffset);
    } else if (t.type === 8 && d.length > 1) {
      const format = (d[0] ?? 0) >> 4;
      const codec = LEGACY_AUDIO[format] ?? `codec ${format}`;
      a ??= {
        id: AUDIO,
        kind: "audio",
        codec,
        timescale: 1000,
        sampleRate: format === 10 ? 44100 : (RATES[((d[0] ?? 0) >> 2) & 3] ?? 44100),
        channels: (d[0] ?? 0) & 1 ? 2 : 1,
      };
      if (format === 10 && d[1] === 0) a.config = d.slice(2);
      if (format !== 10) a.config ??= new Uint8Array(0);
    }
    if (n > 40 && Object.keys(meta).length && v && a) break;
  }
  if (!v && !a) throw new Error("This Flash Video file has no audio or video tags.");
  const width = Number(meta.width);
  const height = Number(meta.height);
  if (v && width > 0) v.width = width;
  if (v && height > 0) v.height = height;
  const index = /** @type {{ times?: unknown[], filepositions?: unknown[] } | undefined} */ (
    meta.keyframes
  );
  /** @type {Key[]} */
  let keys = (index?.times ?? [])
    .map((t, i) => ({ time: Number(t) * 1000, pos: Number(index?.filepositions?.[i]) }))
    .filter((k) => Number.isFinite(k.time) && k.pos >= first - 4);
  if (keys[0]) {
    const b = await source.read(keys[0].pos, 8);
    if (((b[0] ?? 0) & 0x1f) !== 9 && ((b[4] ?? 0) & 0x1f) === 9)
      keys = keys.map((k) => ({ ...k, pos: k.pos + 4 }));
  }

  /** The first tag at or after `from`: a header whose PreviousTagSize after it agrees. */
  const tagNear = async (/** @type {number} */ from) => {
    const b = await source.read(from, 1 << 18);
    for (let i = 0; i + 15 <= b.length; i++) {
      const type = (b[i] ?? 0) & 0x1f;
      if (type !== 8 && type !== 9 && type !== 18) continue;
      const c = new Cursor(b, i + 1);
      const size = c.u24();
      if (i + 15 + size > b.length || new Cursor(b, i + 11 + size).u32() !== size + 11) continue;
      const low = c.u24();
      return { pos: from + i, time: ((c.u8() << 24) | low) >>> 0 };
    }
    return null;
  };

  /**
   * The key frames from about `target` ms back, when onMetaData has no index: bisect the file on
   * tag times, then read tag headers forward (further back while none is at or before the time).
   */
  const keysNear = async (/** @type {number} */ target) => {
    let low = first;
    let high = source.size;
    while (high - low > 1 << 20) {
      const mid = Math.floor((low + high) / 2);
      const t = await tagNear(mid);
      if (t && t.time <= target) low = t.pos;
      else high = mid;
    }
    for (let from = Math.max(first, low - (1 << 19)); ; from = Math.max(first, from - (4 << 20))) {
      const start = from === first ? { pos: first } : await tagNear(from);
      /** @type {Key[]} */
      const found = [];
      const s = new Reader(source, start?.pos ?? first);
      for (;;) {
        const t = await tagAt(s);
        if (!t || t.time > target + 1000) break;
        if (t.type === 9) {
          await s.need(13);
          if (keyTag(s.peek(13).subarray(11))) found.push({ time: t.time, pos: s.pos });
        }
        s.skip(11 + t.size + 4);
      }
      if (found.some((k) => k.time <= target) || from === first) return found;
    }
  };

  /** The key frames at or near `target` ms: onMetaData's index, else found in the file. */
  const allKeys = async (/** @type {number} */ target) =>
    keys.length > 0 ? keys : keysNear(target);

  /** A key frame tag's presentation time: its decode time plus its composition offset. */
  const presented = async (/** @type {Key} */ k) => {
    const b = await source.read(k.pos, 16);
    return ((b[0] ?? 0) & 0x1f) === 9 ? k.time + video(b.subarray(11)).cts : k.time;
  };

  /** The last key frame presented at or before `from` seconds, or null for the start. */
  const keyFor = async (/** @type {number} */ from) => {
    const all = await allKeys(from * 1000);
    let i = -1;
    for (let j = 0; j < all.length; j++) if ((all[j]?.time ?? 0) <= from * 1000 + 0.5) i = j;
    for (; i >= 0; i--) {
      const k = /** @type {Key} */ (all[i]);
      const time = await presented(k);
      if (time <= from * 1000 + 0.5 || i === 0) return { pos: k.pos, time };
    }
    return null;
  };

  /** @param {number} from @param {Set<number>} want @returns {AsyncGenerator<Packet>} */
  async function* packets(from, want) {
    const key = from > 0 && v && want.has(VIDEO) ? await keyFor(from) : null;
    const s = new Reader(source, key?.pos ?? first);
    for (;;) {
      const t = await tagAt(s);
      if (!t) return;
      if (t.type !== 8 && t.type !== 9) {
        s.skip(11 + t.size + 4);
        continue;
      }
      const track = t.type === 9 ? VIDEO : AUDIO;
      if (!want.has(track) || t.size < 2) {
        s.skip(11 + t.size + 4);
        continue;
      }
      s.skip(11);
      const d = await s.take(t.size);
      s.skip(4);
      if (track === VIDEO) {
        const x = video(d);
        if (x.frame && x.data.length > 0)
          yield { track, dts: t.time, pts: t.time + x.cts, key: x.key, data: x.data };
        continue;
      }
      const format = (d[0] ?? 0) >> 4;
      if (format === 10) {
        if (d[1] === 1) yield { track, pts: t.time, key: true, data: d.subarray(2) };
        continue;
      }
      // MP3 tags may hold several frames: the first one carries the tag's time.
      const data = d.subarray(1);
      let first = true;
      for (let i = 0; i + 4 <= data.length; ) {
        const f = format === 2 || format === 14 ? frameAt(data, i) : null;
        const length = f ? f.length : data.length - i;
        /** @type {Packet} */
        const p = { track, key: true, data: data.subarray(i, i + length) };
        if (first) p.pts = t.time;
        first = false;
        yield p;
        i += length;
      }
    }
  }

  const duration = Number(meta.duration);
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    tracks: [v, a].filter((t) => t !== undefined),
    packets,
    async keyframe(/** @type {number} */ time) {
      if (!v) return Math.max(0, time);
      return ((await keyFor(time))?.time ?? 0) / 1000;
    },
  };
}
