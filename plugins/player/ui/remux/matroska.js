// The Matroska and WebM demuxer (RFC 9559): Info and Tracks through the SeekHead, Cues for seeking,
// and the frames of SimpleBlocks and BlockGroups cluster by cluster, with Xiph, EBML and fixed
// lacing and header stripping. Matroska stores presentation times only; timing.js derives the rest.
import { matroskaCodec } from "../codecs.js";
import { makeAsc } from "./audio.js";
import { concat } from "./boxes.js";
import { child, children, elementAt, float, text, uint, vint } from "./ebml.js";
import { PART, Reader } from "./reader.js";

/**
 * @typedef {import("./reader.js").Source} Source
 * @typedef {import("./config.js").DemuxTrack} DemuxTrack
 * @typedef {import("./timing.js").Packet} Packet
 * @typedef {import("./ebml.js").Element} Element
 * @typedef {{ duration: number, tracks: DemuxTrack[],
 *   packets(from: number, want: Set<number>): AsyncGenerator<Packet>,
 *   keyframe(time: number): Promise<number> }} Demuxed
 */

const ID = {
  ebml: 0x1a45dfa3,
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  info: 0x1549a966,
  scale: 0x2ad7b1,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  entry: 0xae,
  number: 0xd7,
  type: 0x83,
  codec: 0x86,
  private: 0x63a2,
  defaultDuration: 0x23e383,
  flagDefault: 0x88,
  video: 0xe0,
  width: 0xb0,
  height: 0xba,
  audio: 0xe1,
  rate: 0xb5,
  channels: 0x9f,
  depth: 0x6264,
  encodings: 0x6d80,
  encoding: 0x6240,
  compression: 0x5034,
  algorithm: 0x4254,
  settings: 0x4255,
  encryption: 0x5035,
  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  positions: 0xb7,
  cueTrack: 0xf7,
  cueCluster: 0xf1,
  cluster: 0x1f43b675,
  timestamp: 0xe7,
  simple: 0xa3,
  group: 0xa0,
  block: 0xa1,
  reference: 0xfb,
  tags: 0x1254c367,
  chapters: 0x1043a770,
  attachments: 0x1941a469,
  codecDelay: 0x56aa,
};
const TOP = new Set([
  ID.cluster,
  ID.cues,
  ID.tags,
  ID.chapters,
  ID.attachments,
  ID.info,
  ID.tracks,
  ID.seekHead,
]);
const AAC_TYPES = /** @type {Record<string, number>} */ ({ MAIN: 1, LC: 2, SSR: 3, LTP: 4 });

/** Bytes [at, at + size) in parts of at most 1 MiB. */
async function readAll(
  /** @type {Source} */ source,
  /** @type {number} */ at,
  /** @type {number} */ size,
) {
  const out = new Uint8Array(size);
  for (let done = 0; done < size; ) {
    const part = await source.read(at + done, Math.min(PART, size - done));
    if (part.length === 0) return out.subarray(0, done);
    out.set(part, done);
    done += part.length;
  }
  return out;
}

/** The people name for a codec id; PCM in floats is not one MP4 takes. */
function codecOf(/** @type {string} */ id) {
  if (id.startsWith("A_AC3")) return "AC-3";
  if (id === "A_PCM/INT/LIT" || id === "A_PCM/INT/BIG") return "PCM";
  if (id === "A_PCM/FLOAT/IEEE") return "PCM (float)";
  return matroskaCodec(id);
}

/** One TrackEntry as a demuxed track. */
function trackOf(
  /** @type {Uint8Array} */ b,
  /** @type {Element} */ entry,
  /** @type {number} */ ticks,
) {
  const parts = children(b, entry.at, entry.end);
  const get = (/** @type {number} */ id) => parts.find((p) => p.id === id);
  const num = (/** @type {number} */ id, fallback = 0) => {
    const e = get(id);
    return e ? uint(b, e) : fallback;
  };
  const type = num(ID.type);
  const codecElement = get(ID.codec);
  const id = codecElement ? text(b, codecElement) : "";
  const priv = get(ID.private);
  /** @type {DemuxTrack & { strip?: Uint8Array, encrypted?: boolean, compressed?: boolean, lace?: number }} */
  const track = {
    id: num(ID.number),
    kind: type === 1 ? "video" : "audio",
    codec: codecOf(id),
    timescale: ticks,
    default: num(ID.flagDefault, 1) === 1,
  };
  if (priv) track.config = b.slice(priv.at, priv.end);
  // CodecDelay is subtracted from every block's time (RFC 9559 5.1.4.1.28.30); kept in ticks.
  const delay = num(ID.codecDelay);
  if (delay) /** @type {{ delay?: number }} */ (track).delay = (delay * ticks) / 1e9;
  const lace = num(ID.defaultDuration);
  if (lace) track.lace = Math.round((lace * ticks) / 1e9);
  const video = get(ID.video);
  if (video) {
    const w = child(b, video, ID.width);
    const h = child(b, video, ID.height);
    if (w) track.width = uint(b, w);
    if (h) track.height = uint(b, h);
  }
  const audio = get(ID.audio);
  if (audio) {
    const rate = child(b, audio, ID.rate);
    const channels = child(b, audio, ID.channels);
    const depth = child(b, audio, ID.depth);
    track.sampleRate = rate ? Math.round(float(b, rate)) : 8000;
    track.channels = channels ? uint(b, channels) : 1;
    if (depth) track.bits = uint(b, depth);
  }
  if (id === "A_PCM/INT/LIT") track.little = true;
  if (id.startsWith("A_AAC/") && !track.config) {
    const profile = AAC_TYPES[id.split("/")[2] ?? "LC"] ?? 2;
    track.config = makeAsc(profile, track.sampleRate ?? 48000, track.channels ?? 2);
  }
  const encodings = get(ID.encodings);
  for (const e of encodings
    ? children(b, encodings.at, encodings.end).filter((c) => c.id === ID.encoding)
    : []) {
    if (child(b, e, ID.encryption)) track.encrypted = true;
    const compression = child(b, e, ID.compression);
    if (!compression) continue;
    const algorithm = child(b, compression, ID.algorithm);
    const settings = child(b, compression, ID.settings);
    if (algorithm && uint(b, algorithm) === 3 && settings)
      track.strip = b.slice(settings.at, settings.end);
    else track.compressed = true;
  }
  return type === 1 || type === 2 ? track : null;
}

/** The frames of one block: lacing (RFC 9559 10.3) splits it. */
function frames(/** @type {Uint8Array} */ b) {
  const tn = vint(b, 0);
  if (!tn) return null;
  let at = tn.length;
  const rel = (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16)) >> 16;
  const flags = b[at + 2] ?? 0;
  at += 3;
  const lacing = (flags >> 1) & 3;
  if (lacing === 0) return { track: tn.value, rel, flags, parts: [b.subarray(at)] };
  const count = (b[at++] ?? 0) + 1;
  /** @type {number[]} */
  const sizes = [];
  if (lacing === 1)
    for (let i = 0; i < count - 1; i++) {
      let size = 0;
      while ((b[at] ?? 0) === 255) size += b[at++] ?? 0;
      sizes.push(size + (b[at++] ?? 0));
    }
  else if (lacing === 3) {
    const first = vint(b, at);
    if (!first) return null;
    sizes.push(first.value);
    at += first.length;
    for (let i = 1; i < count - 1; i++) {
      const d = vint(b, at);
      if (!d) return null;
      at += d.length;
      sizes.push((sizes[i - 1] ?? 0) + d.value - (2 ** (7 * d.length - 1) - 1));
    }
  } else for (let i = 0; i < count - 1; i++) sizes.push(Math.floor((b.length - at) / count));
  const parts = [];
  for (const size of sizes) {
    parts.push(b.subarray(at, at + size));
    at += size;
  }
  parts.push(b.subarray(at));
  return { track: tn.value, rel, flags, parts };
}

/** @param {Source} source @returns {Promise<Demuxed>} */
export async function openMatroska(source) {
  const head = await source.read(0, 4096);
  const ebml = elementAt(head, 0);
  if (!ebml || ebml.id !== ID.ebml || ebml.size < 0) throw new Error("The EBML header is damaged.");
  const segment = elementAt(await source.read(ebml.end, 16), 0);
  if (!segment || segment.id !== ID.segment) throw new Error("This Matroska file has no segment.");
  const base = ebml.end + segment.head;
  const end = segment.size < 0 ? source.size : Math.min(source.size, base + segment.size);
  /** @type {Map<number, Uint8Array>} */
  const found = new Map();
  /** @type {Map<number, number>} */
  const seeks = new Map();
  let firstCluster = -1;
  const visit = async (/** @type {number} */ at) => {
    const e = elementAt(await source.read(at, 16), 0);
    if (!e) return null;
    if (e.id === ID.cluster) return e;
    const wanted = [ID.info, ID.tracks, ID.cues, ID.seekHead].includes(e.id);
    if (wanted && e.size >= 0 && e.size <= 1 << 24 && !(e.id !== ID.seekHead && found.has(e.id))) {
      const bytes = await readAll(source, at + e.head, e.size);
      if (e.id === ID.seekHead)
        for (const s of children(bytes).filter((c) => c.id === ID.seek)) {
          const id = child(bytes, s, ID.seekId);
          const pos = child(bytes, s, ID.seekPosition);
          if (id && pos) seeks.set(uint(bytes, id), base + uint(bytes, pos));
        }
      else found.set(e.id, bytes);
    }
    return e;
  };
  for (let at = base, n = 0; at < end && n < 512; n++) {
    const e = await visit(at);
    if (!e) break;
    if (e.id === ID.cluster) {
      firstCluster = at;
      break;
    }
    if (e.size < 0) break;
    at += e.head + e.size;
  }
  for (const id of [ID.info, ID.tracks, ID.cues]) {
    const at = seeks.get(id);
    if (!found.has(id) && at !== undefined && at < end) await visit(at);
  }
  if (firstCluster < 0) firstCluster = seeks.get(ID.cluster) ?? -1;
  const info = found.get(ID.info) ?? new Uint8Array(0);
  const parts = children(info);
  const scaleElement = parts.find((p) => p.id === ID.scale);
  const scale = scaleElement ? uint(info, scaleElement) : 1e6;
  const ticks = Math.round(1e9 / scale);
  const durationElement = parts.find((p) => p.id === ID.duration);
  const duration = durationElement ? (float(info, durationElement) * scale) / 1e9 : 0;
  const tracksBytes = found.get(ID.tracks);
  if (!tracksBytes || firstCluster < 0)
    throw new Error("This Matroska file has no tracks or no clusters.");
  const tracks = children(tracksBytes)
    .filter((e) => e.id === ID.entry)
    .map((e) => trackOf(tracksBytes, e, ticks))
    .filter((t) => t !== null);
  if (tracks.some((t) => t.encrypted)) throw new Error("This Matroska file is encrypted.");
  const cueBytes = found.get(ID.cues);
  const cues = cueBytes
    ? children(cueBytes)
        .filter((e) => e.id === ID.cuePoint)
        .flatMap((point) => {
          const time = child(cueBytes, point, ID.cueTime);
          return children(cueBytes, point.at, point.end)
            .filter((c) => c.id === ID.positions)
            .map((p) => {
              const track = child(cueBytes, p, ID.cueTrack);
              const cluster = child(cueBytes, p, ID.cueCluster);
              return {
                time: time ? uint(cueBytes, time) : 0,
                track: track ? uint(cueBytes, track) : 0,
                at: cluster ? base + uint(cueBytes, cluster) : firstCluster,
              };
            });
        })
        .sort((a, b) => a.time - b.time)
    : [];
  const byId = new Map(tracks.map((t) => [t.id, t]));

  /** Where to start reading for `from` seconds: the cluster of the cue at or before it. */
  const startOf = (/** @type {number} */ from, /** @type {Set<number>} */ want) => {
    const video = tracks.find((t) => t.kind === "video" && want.has(t.id));
    const mine = cues.filter((c) => !video || c.track === video.id);
    let at = firstCluster;
    for (const c of mine) if (c.time <= from * ticks + 0.5) at = c.at;
    return at;
  };

  /** @param {number} from @param {Set<number>} want @returns {AsyncGenerator<Packet>} */
  async function* packets(from, want) {
    const r = new Reader(source, startOf(from, want));
    while (r.pos < end) {
      await r.need(16);
      const h = elementAt(r.peek(16), 0);
      if (!h) return;
      if (h.id !== ID.cluster) {
        if (h.size < 0) return;
        r.skip(h.head + h.size);
        continue;
      }
      r.skip(h.head);
      const clusterEnd = h.size < 0 ? end : r.pos + h.size;
      let ts = 0;
      while (r.pos < clusterEnd) {
        await r.need(16);
        const e = elementAt(r.peek(16), 0);
        if (!e || e.size < 0 || (h.size < 0 && TOP.has(e.id))) break;
        if (e.id !== ID.timestamp && e.id !== ID.simple && e.id !== ID.group) {
          r.skip(e.head + e.size);
          continue;
        }
        await r.need(e.head + 8);
        if (e.id === ID.simple) {
          const tn = vint(r.peek(e.head + 8), e.head);
          if (tn && !want.has(tn.value)) {
            r.skip(e.head + e.size);
            continue;
          }
        }
        const b = await r.take(e.head + e.size);
        if (e.id === ID.timestamp) {
          ts = uint(b, { ...e, at: e.head, end: e.head + e.size });
          continue;
        }
        let block = b.subarray(e.head);
        let key = true;
        if (e.id === ID.group) {
          const inner = children(block);
          const blockElement = inner.find((c) => c.id === ID.block);
          if (!blockElement) continue;
          key = !inner.some((c) => c.id === ID.reference);
          block = block.subarray(blockElement.at, blockElement.end);
        }
        const f = frames(block);
        const track = f ? byId.get(f.track) : undefined;
        if (!f || !track || !want.has(track.id)) continue;
        if (e.id === ID.simple) key = (f.flags & 0x80) !== 0;
        const strip = /** @type {{ strip?: Uint8Array }} */ (track).strip;
        const lace = /** @type {{ lace?: number }} */ (track).lace;
        const delay = /** @type {{ delay?: number }} */ (track).delay ?? 0;
        for (let i = 0; i < f.parts.length; i++) {
          const part = /** @type {Uint8Array} */ (f.parts[i]);
          const data = strip ? concat([strip, part]) : part;
          /** @type {Packet} */
          const p = { track: track.id, key: track.kind === "audio" || key, data };
          if (i === 0) p.pts = ts + f.rel - delay;
          else if (lace) p.pts = ts + f.rel + i * lace - delay;
          yield p;
        }
      }
      if (h.size >= 0) r.seek(clusterEnd);
    }
  }

  return {
    duration,
    tracks: tracks.map((t) => {
      if (/** @type {{ compressed?: boolean }} */ (t).compressed)
        return { ...t, codec: `${t.codec} (compressed)` };
      return t;
    }),
    packets,
    async keyframe(time) {
      const video = tracks.find((t) => t.kind === "video");
      const want = new Set(tracks.map((t) => t.id));
      for await (const p of packets(time, want))
        if ((!video || p.track === video.id) && p.key && p.pts !== undefined) return p.pts / ticks;
      return 0;
    },
  };
}
