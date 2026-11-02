// The Ogg demuxer (RFC 3533) for the codecs MP4 carries: Opus (RFC 7845; times from granule
// positions in 48 kHz samples, less the pre-skip) and FLAC (the Ogg FLAC mapping; times from each
// frame's own sample number). Seeking bisects the file on granule positions. Vorbis, Theora and
// Speex are named so the player can say why it plays them another way.
import { Cursor } from "../bytes.js";
import { flacFrame, opusSamples, streamInfo } from "./audio.js";
import { concat } from "./boxes.js";
import { Reader } from "./reader.js";

/**
 * @typedef {import("./reader.js").Source} Source
 * @typedef {import("./config.js").DemuxTrack} DemuxTrack
 * @typedef {import("./timing.js").Packet} Packet
 * @typedef {{ pos: number, type: number, granule: number, serial: number, length: number,
 *   laces: number[] }} Page
 */

/** The page whose header is at the reader's position, or null. */
async function pageAt(/** @type {Reader} */ r) {
  if ((await r.need(27)) < 27) return null;
  const h = r.peek(27);
  if (h[0] !== 0x4f || h[1] !== 0x67 || h[2] !== 0x67 || h[3] !== 0x53) return null;
  const c = new Cursor(h, 5, true);
  const type = c.u8();
  const low = c.u32();
  const high = c.i32();
  const granule = high === -1 && low === 0xffffffff ? -1 : high * 2 ** 32 + low;
  const serial = c.u32();
  const count = h[26] ?? 0;
  await r.need(27 + count);
  const laces = [...r.peek(27 + count).subarray(27)];
  return {
    pos: r.pos,
    type,
    granule,
    serial,
    length: 27 + count + laces.reduce((a, b) => a + b, 0),
    laces,
  };
}

/** The first page header at or after `at` (a capture pattern whose header parses). */
async function findPage(
  /** @type {Source} */ source,
  /** @type {number} */ at,
  /** @type {number} */ serial,
) {
  const r = new Reader(source, at);
  for (let tries = 0; tries < 4 && r.pos < source.size; tries++) {
    await r.need(65536);
    const b = r.peek(65536);
    for (let i = 0; i + 27 <= b.length; i++) {
      if (b[i] !== 0x4f || b[i + 1] !== 0x67 || b[i + 2] !== 0x67 || b[i + 3] !== 0x53) continue;
      const p = new Reader(source, r.pos + i);
      const page = await pageAt(p);
      if (page && page.serial === serial) return page;
    }
    r.skip(Math.max(1, b.length - 26));
  }
  return null;
}

/** What a stream's first packet says it is. */
function identify(/** @type {Uint8Array} */ p, /** @type {number} */ serial) {
  const text = String.fromCharCode(...p.subarray(0, 8));
  /** @type {DemuxTrack & { headers: number, preskip: number }} */
  const t = { id: serial, kind: "audio", codec: "", timescale: 48000, headers: 1, preskip: 0 };
  if (text === "OpusHead") {
    t.codec = "Opus";
    t.config = p.slice();
    t.channels = p[9] ?? 2;
    t.preskip = new Cursor(p, 10, true).u16();
    t.headers = 2;
  } else if (p[0] === 0x7f && text.slice(1, 5) === "FLAC") {
    const info = p.subarray(17, 17 + 34);
    const s = streamInfo(info);
    t.codec = "FLAC";
    t.config = info.slice();
    t.timescale = s.rate;
    t.sampleRate = s.rate;
    t.channels = s.channels;
    t.headers = 1 + (((p[7] ?? 0) << 8) | (p[8] ?? 0));
    /** @type {{ block?: number }} */ (t).block = s.minBlock;
  } else if (text.startsWith("\x01vorbis")) t.codec = "Vorbis";
  else if (text.startsWith("\x80theora")) {
    t.codec = "Theora";
    t.kind = "video";
  } else if (text.startsWith("Speex")) t.codec = "Speex";
  else t.codec = "an unknown codec";
  return t;
}

/** @param {Source} source */
export async function openOgg(source) {
  const r = new Reader(source, 0);
  /** @type {Map<number, ReturnType<typeof identify>>} */
  const streams = new Map();
  let dataStart = 0;
  for (let n = 0; n < 64; n++) {
    const page = await pageAt(r);
    if (!page) break;
    if (!(page.type & 2)) break;
    const body = r.peek(page.length).subarray(page.length - page.laces.reduce((a, b) => a + b, 0));
    streams.set(page.serial, identify(body.subarray(0, page.laces[0] ?? 0), page.serial));
    r.skip(page.length);
    dataStart = r.pos;
  }
  if (streams.size === 0) throw new Error("This Ogg file has no stream the player knows.");
  const tracks = [...streams.values()];
  const audio = tracks.find((t) => t.codec === "Opus" || t.codec === "FLAC");
  const time = (/** @type {ReturnType<typeof identify>} */ t, /** @type {number} */ granule) =>
    (granule - (t.codec === "Opus" ? t.preskip : 0)) / t.timescale;
  let duration = 0;
  if (audio) {
    const tail = await source.read(Math.max(0, source.size - 65536), 65536);
    for (let i = tail.length - 27; i >= 0; i--) {
      if (tail[i] !== 0x4f || tail[i + 1] !== 0x67 || tail[i + 2] !== 0x67 || tail[i + 3] !== 0x53)
        continue;
      const c = new Cursor(tail, i + 6, true);
      const low = c.u32();
      const high = c.i32();
      if (c.u32() === audio.id && high >= 0) {
        duration = time(audio, high * 2 ** 32 + low);
        break;
      }
    }
  }

  /** Where to start for `from` seconds: the last page of the stream that ends before it. */
  const startOf = async (
    /** @type {number} */ from,
    /** @type {ReturnType<typeof identify>} */ t,
  ) => {
    // Opus decoders need 80 ms of pre-roll before the first sample they are to play.
    const target = from * t.timescale + (t.codec === "Opus" ? t.preskip - 3840 : 0);
    if (from <= 0 || target <= 0) return dataStart;
    let low = dataStart;
    let high = source.size;
    let best = dataStart;
    while (high - low > 65536) {
      const mid = Math.floor((low + high) / 2);
      const page = await findPage(source, mid, t.id);
      if (!page || page.granule < 0) {
        high = mid;
        continue;
      }
      if (page.granule < target) {
        best = page.pos;
        low = mid;
      } else high = mid;
    }
    return best;
  };

  /** @param {number} from @param {Set<number>} want @returns {AsyncGenerator<Packet>} */
  async function* packets(from, want) {
    const t = audio && want.has(audio.id) ? audio : undefined;
    if (!t) return;
    const start = await startOf(from, t);
    const s = new Reader(source, start);
    // The identification header was on the first page; the rest come first from the start.
    let headers = start === dataStart ? 1 : t.headers;
    /** @type {Uint8Array[]} */
    let partial = [];
    let fresh = start !== dataStart;
    /** @type {number | null} */
    let previous = null;
    for (;;) {
      const page = await pageAt(s);
      if (!page) return;
      const all = s.peek(page.length);
      s.skip(page.length);
      if (page.serial !== t.id) continue;
      let at = 27 + page.laces.length;
      /** @type {Uint8Array[]} */
      const done = [];
      let piece = 0;
      for (const lace of page.laces) {
        piece += lace;
        if (lace === 255) continue;
        const part = all.subarray(at, at + piece);
        at += piece;
        piece = 0;
        if (fresh && page.type & 1 && done.length === 0 && partial.length === 0) {
          fresh = false;
          continue;
        }
        fresh = false;
        done.push(partial.length ? concat([...partial, part]) : part);
        partial = [];
      }
      if (piece > 0) partial.push(all.subarray(at, at + piece));
      const audioPackets = [];
      for (const p of done) {
        if (headers < t.headers) {
          headers++;
          continue;
        }
        audioPackets.push(p);
      }
      if (audioPackets.length === 0) {
        if (page.granule >= 0) previous = page.granule;
        continue;
      }
      if (t.codec === "FLAC") {
        const block = /** @type {{ block?: number }} */ (t).block ?? 4096;
        for (const p of audioPackets) {
          const f = flacFrame(p);
          if (!f) continue;
          yield { track: t.id, pts: f.variable ? f.number : f.number * block, key: true, data: p };
        }
        continue;
      }
      const durations = audioPackets.map(opusSamples);
      const total = durations.reduce((a, b) => a + b, 0);
      let begin = previous !== null ? previous : page.granule >= 0 ? page.granule - total : 0;
      for (let i = 0; i < audioPackets.length; i++) {
        yield {
          track: t.id,
          pts: begin - t.preskip,
          key: true,
          data: /** @type {Uint8Array} */ (audioPackets[i]),
        };
        begin += durations[i] ?? 0;
      }
      previous = page.granule >= 0 ? page.granule : begin;
    }
  }

  return {
    duration,
    tracks: tracks.map(({ headers, preskip, ...t }) => t),
    packets,
    async keyframe(/** @type {number} */ time) {
      if (!audio) return 0;
      let best = 0;
      for await (const p of packets(time, new Set([audio.id]))) {
        const at = (p.pts ?? 0) / audio.timescale;
        if (at > time) break;
        best = Math.max(0, at);
      }
      return best;
    },
  };
}
