// The MPEG transport stream demuxer (ISO/IEC 13818-1), also with the four-byte timecodes of .m2ts:
// the program from PAT and PMT, each elementary stream's PES packets with their 90 kHz PTS and DTS
// (from the first one, so the file starts at zero), audio PES split into its ADTS, AC-3 or MP3
// frames, and seeking by bisection on video PTS to a random access point.
import { frameAt } from "../probe/mp3.js";
import { ac3At, adtsAt } from "./audio.js";
import { concat } from "./boxes.js";
import { avcType, hevcType, splitAnnexB } from "./nal.js";
import { Reader } from "./reader.js";

/**
 * @typedef {import("./reader.js").Source} Source
 * @typedef {import("./config.js").DemuxTrack} DemuxTrack
 * @typedef {import("./timing.js").Packet} Packet
 * @typedef {{ pid: number, pusi: boolean, random: boolean, payload: Uint8Array, at: number }} TsPacket
 */

const TYPES = /** @type {Record<number, [DemuxTrack["kind"], string]>} */ ({
  1: ["video", "MPEG-1 Video"],
  2: ["video", "MPEG-2 Video"],
  16: ["video", "MPEG-4 Part 2"],
  27: ["video", "H.264"],
  36: ["video", "HEVC"],
  234: ["video", "VC-1"],
  3: ["audio", "MPEG audio"],
  4: ["audio", "MPEG audio"],
  15: ["audio", "AAC"],
  17: ["audio", "AAC (LATM)"],
  128: ["audio", "PCM (Blu-ray)"],
  129: ["audio", "AC-3"],
  130: ["audio", "DTS"],
  131: ["audio", "Dolby TrueHD"],
  132: ["audio", "E-AC-3"],
  133: ["audio", "DTS-HD"],
  134: ["audio", "DTS-HD"],
  135: ["audio", "E-AC-3"],
});
const WRAP = 2 ** 33;

/** The packet size and the offset of the first sync byte: 188, or 192 with a timecode first. */
function layout(/** @type {Uint8Array} */ b) {
  for (const [size, lead] of [
    [188, 0],
    [192, 4],
    [204, 0],
  ])
    if ([0, 1, 2].every((i) => b[lead + i * size] === 0x47)) return { size, lead };
  return null;
}

/** One transport packet at `at` in `b` (its sync byte at `at`). */
function packetAt(/** @type {Uint8Array} */ b, /** @type {number} */ at) {
  const pid = (((b[at + 1] ?? 0) & 0x1f) << 8) | (b[at + 2] ?? 0);
  const pusi = ((b[at + 1] ?? 0) & 0x40) !== 0;
  const control = ((b[at + 3] ?? 0) >> 4) & 3;
  let start = at + 4;
  let random = false;
  if (control & 2) {
    const length = b[at + 4] ?? 0;
    random = length > 0 && ((b[at + 5] ?? 0) & 0x40) !== 0;
    start += 1 + length;
  }
  return {
    pid,
    pusi,
    random,
    payload: control & 1 ? b.subarray(Math.min(start, at + 188), at + 188) : new Uint8Array(0),
    at,
  };
}

/** A PES header's PTS and DTS (90 kHz) and where its payload starts. */
function pesHeader(/** @type {Uint8Array} */ b) {
  if (b[0] !== 0 || b[1] !== 0 || b[2] !== 1) return null;
  const flags = b[7] ?? 0;
  const ts = (/** @type {number} */ at) =>
    (((b[at] ?? 0) >> 1) & 7) * 2 ** 30 +
    ((b[at + 1] ?? 0) << 22) +
    (((b[at + 2] ?? 0) >> 1) << 15) +
    ((b[at + 3] ?? 0) << 7) +
    ((b[at + 4] ?? 0) >> 1);
  const pts = flags & 0x80 ? ts(9) : undefined;
  const dts = (flags & 0xc0) === 0xc0 ? ts(14) : pts;
  return { pts, dts, start: 9 + (b[8] ?? 0) };
}

/** @param {Source} source */
export async function openMpegTs(source) {
  const head = await source.read(0, 1 << 20);
  const l = layout(head);
  if (!l) throw new Error("This transport stream has no sync bytes.");
  const { size, lead } = l;
  /** @type {Map<number, DemuxTrack & { first?: number }>} */
  const streams = new Map();
  let pmt = -1;
  for (let at = lead; at + 188 <= head.length && (pmt < 0 || streams.size === 0); at += size) {
    const p = packetAt(head, at);
    if (!p.pusi) continue;
    const s = p.payload.subarray(1 + (p.payload[0] ?? 0));
    if (p.pid === 0 && s[0] === 0) pmt = (((s[10] ?? 0) & 0x1f) << 8) | (s[11] ?? 0);
    else if (p.pid === pmt && s[0] === 2) {
      const end = Math.min(s.length, 3 + ((((s[1] ?? 0) & 0x0f) << 8) | (s[2] ?? 0)) - 4);
      let i = 12 + ((((s[10] ?? 0) & 0x0f) << 8) | (s[11] ?? 0));
      while (i + 5 <= end) {
        const type = s[i] ?? 0;
        const pid = (((s[i + 1] ?? 0) & 0x1f) << 8) | (s[i + 2] ?? 0);
        const info = (((s[i + 3] ?? 0) & 0x0f) << 8) | (s[i + 4] ?? 0);
        const descriptors = s.subarray(i + 5, i + 5 + info);
        let [kind, codec] = TYPES[type] ?? [undefined, ""];
        for (let d = 0; d + 2 <= descriptors.length; d += 2 + (descriptors[d + 1] ?? 0)) {
          const tag = descriptors[d];
          if (type === 6 && tag === 0x6a) [kind, codec] = ["audio", "AC-3"];
          if (type === 6 && tag === 0x7a) [kind, codec] = ["audio", "E-AC-3"];
        }
        if (kind) streams.set(pid, { id: pid, kind, codec, timescale: 90000 });
        i += 5 + info;
      }
    }
  }
  if (streams.size === 0)
    throw new Error("This transport stream has no program the player can read.");
  const video = [...streams.values()].find((t) => t.kind === "video");
  const leadPid = (video ?? [...streams.values()][0])?.id ?? -1;

  /** The PTS of the first PES of `pid` at or after file offset `from`, scanning `span` bytes. */
  const ptsAfter = async (
    /** @type {number} */ from,
    /** @type {number} */ pid,
    span = 1 << 18,
  ) => {
    const start = from - ((((from - lead) % size) + size) % size);
    const b = await source.read(start, span);
    for (let at = 0; at + 188 <= b.length; at += size) {
      if (b[at] !== 0x47) return null;
      const p = packetAt(b, at);
      if (p.pid !== pid || !p.pusi) continue;
      const h = pesHeader(p.payload);
      if (h?.pts !== undefined)
        return { pts: h.pts, dts: h.dts ?? h.pts, at: start + at, random: p.random };
    }
    return null;
  };
  // Time zero is the earliest decode time of any stream, so no sample starts before it.
  const firstDts = (await ptsAfter(lead, leadPid))?.dts ?? 0;
  let zero = firstDts;
  for (const t of streams.values()) {
    const p = await ptsAfter(lead, t.id);
    if (p && (p.dts - zero + WRAP) % WRAP > WRAP / 2) zero = p.dts;
  }
  const rel = (/** @type {number} */ pts) => {
    const d = (pts - zero + WRAP) % WRAP;
    return d > WRAP / 2 ? d - WRAP : d;
  };
  let duration = 0;
  for (let back = 1 << 18; back <= 1 << 22 && duration === 0; back *= 4) {
    const from = Math.max(lead, source.size - back);
    const b = await source.read(from - ((from - lead) % size), back);
    for (let at = 0; at + 188 <= b.length; at += size) {
      const p = packetAt(b, at);
      const h = p.pid === leadPid && p.pusi ? pesHeader(p.payload) : null;
      if (h?.pts !== undefined) duration = Math.max(duration, rel(h.pts) / 90000);
    }
  }

  /** Transport packets one after another from the sync byte at or after `from`. */
  async function* units(/** @type {number} */ from) {
    const r = new Reader(source, from - ((((from - lead) % size) + size) % size) - lead);
    for (;;) {
      if ((await r.need(size)) < size) return;
      const at = r.pos + lead;
      const b = r.peek(size);
      r.skip(size);
      if (b[lead] === 0x47) yield { at, p: packetAt(b, lead) };
    }
  }

  /** The random access points of the lead stream from `from` until past `target` (90 kHz). */
  const scan = async (
    /** @type {number} */ from,
    /** @type {number} */ target,
    /** @type {number} */ limit,
  ) => {
    /** @type {{ at: number, pts: number } | null} */
    let best = null;
    /** @type {{ at: number, pts: number } | null} */
    let after = null;
    for await (const { at, p } of units(from)) {
      if (at > limit) break;
      if (p.pid !== leadPid || !p.pusi) continue;
      const h = pesHeader(p.payload);
      if (h?.pts === undefined) continue;
      const point = p.random || !video ? { at, pts: rel(h.pts) } : null;
      if (rel(h.pts) > target + 1) {
        after ??= point;
        if (best || after) break;
      } else if (point) best = point;
    }
    return { best, after };
  };

  /** The offset of the random access point at or before `time` seconds, and its time. */
  const startOf = async (/** @type {number} */ time) => {
    const target = time * 90000;
    let low = lead;
    let high = source.size;
    while (high - low > 1 << 20) {
      const mid = Math.floor((low + high) / 2);
      const p = await ptsAfter(mid, leadPid);
      if (p && rel(p.pts) <= target) low = mid;
      else high = mid;
    }
    // From a little before, the last random access point not after the time; further back if none.
    for (let from = Math.max(lead, low - (1 << 19)); ; from = Math.max(lead, from - (4 << 20))) {
      const found = await scan(from, target, low + (8 << 20));
      // Before the first key frame there is none at or before the time: the first one, then.
      if (found.best || from === lead) return found.best ?? found.after ?? { at: lead, pts: 0 };
    }
  };

  /** @param {number} from @param {Set<number>} want @returns {AsyncGenerator<Packet>} */
  async function* packets(from, want) {
    const start = from > 0 ? (await startOf(from)).at : lead;
    /** @type {Map<number, { parts: Uint8Array[], pts?: number, dts?: number, random: boolean }>} */
    const open = new Map();
    /** @type {Map<number, Uint8Array>} */
    const carry = new Map();
    const finish = function* (/** @type {number} */ pid) {
      const pes = open.get(pid);
      const t = streams.get(pid);
      open.delete(pid);
      if (!pes || !t || pes.parts.length === 0) return;
      const data = concat(pes.parts);
      const pts = pes.pts === undefined ? undefined : rel(pes.pts);
      const dts = pes.dts === undefined ? pts : rel(pes.dts);
      if (t.kind === "video") {
        const nals = splitAnnexB(data);
        const key =
          pes.random ||
          nals.some((n) =>
            t.codec === "HEVC" ? hevcType(n) >= 16 && hevcType(n) <= 21 : avcType(n) === 5,
          );
        yield { track: pid, pts, dts, key, data };
        return;
      }
      const joined = concat([carry.get(pid) ?? new Uint8Array(0), data]);
      let at = 0;
      let first = !carry.get(pid)?.length;
      while (at + 7 <= joined.length) {
        const length =
          t.codec === "AAC"
            ? (adtsAt(joined, at)?.length ?? 0)
            : t.codec.includes("AC-3")
              ? (ac3At(joined, at)?.length ?? 0)
              : (frameAt(joined, at)?.length ?? 0);
        if (!length) {
          at++;
          continue;
        }
        if (at + length > joined.length) break;
        /** @type {Packet} */
        const p = { track: pid, key: true, data: joined.subarray(at, at + length) };
        if (first) p.pts = pts;
        first = false;
        yield p;
        at += length;
      }
      carry.set(pid, joined.slice(at));
    };
    for await (const { p } of units(start)) {
      if (!want.has(p.pid) || !streams.has(p.pid)) continue;
      if (p.pusi) {
        yield* finish(p.pid);
        const h = pesHeader(p.payload);
        if (!h) continue;
        open.set(p.pid, {
          parts: [p.payload.slice(h.start)],
          pts: h.pts,
          dts: h.dts,
          random: p.random,
        });
      } else open.get(p.pid)?.parts.push(p.payload.slice());
    }
    for (const pid of [...open.keys()]) yield* finish(pid);
  }

  /** MPEG audio is MP3 only at layer III; MP2 the player does not remux. */
  for (const t of streams.values()) {
    if (t.codec !== "MPEG audio") continue;
    const p = await ptsAfter(lead, t.id);
    const b = p ? await source.read(p.at, 188) : new Uint8Array(0);
    const payload = b.length ? packetAt(b, 0).payload : b;
    const h = pesHeader(payload);
    const frame = h ? frameAt(payload, h.start) : null;
    t.codec = frame?.layer === 3 ? "MP3" : "MP2";
  }

  return {
    duration,
    tracks: [...streams.values()],
    packets,
    async keyframe(/** @type {number} */ time) {
      return (await startOf(Math.max(0, time))).pts / 90000;
    },
  };
}
