// MPEG transport streams (TS, M2TS) and program streams (MPG, VOB): the stream types from the PAT
// and PMT or the PES stream ids, sizes from the video's own headers, and the duration from the first
// timestamps at the start and the last ones in the final megabyte.
import { latin1 } from "../bytes.js";
import { annexBSize, mpegVideoSize } from "./h264.js";
import { frameAt } from "./mp3.js";

/**
 * @typedef {import("./index.js").Read} Read
 * @typedef {import("./index.js").Track} Track
 */

const WINDOW = 1 << 20;

/** @type {Record<number, [Track["kind"], string]>} */
const STREAM_TYPES = {
  1: ["video", "MPEG-1 Video"],
  2: ["video", "MPEG-2 Video"],
  3: ["audio", "MPEG audio"],
  4: ["audio", "MPEG audio"],
  15: ["audio", "AAC"],
  17: ["audio", "AAC (LATM)"],
  27: ["video", "H.264"],
  36: ["video", "HEVC"],
  51: ["video", "VVC"],
  128: ["audio", "LPCM"],
  129: ["audio", "AC-3"],
  130: ["audio", "DTS"],
  131: ["audio", "Dolby TrueHD"],
  132: ["audio", "E-AC-3"],
  133: ["audio", "DTS-HD"],
  134: ["audio", "DTS-HD"],
  135: ["audio", "E-AC-3"],
  144: ["subtitle", "PGS"],
  234: ["video", "VC-1"],
};

/** A PES header's PTS at `at` (the 5 bytes after the flags), in 90 kHz ticks. */
const pts = (/** @type {Uint8Array} */ b, /** @type {number} */ at) =>
  (((b[at] ?? 0) >> 1) & 7) * 2 ** 30 +
  ((b[at + 1] ?? 0) << 22) +
  (((b[at + 2] ?? 0) >> 1) << 15) +
  ((b[at + 3] ?? 0) << 7) +
  ((b[at + 4] ?? 0) >> 1);

/** The PTS of a PES packet starting at `at` (00 00 01 id), MPEG-1 or MPEG-2 style, or null. */
function pesPts(/** @type {Uint8Array} */ b, /** @type {number} */ at) {
  if (((b[at + 6] ?? 0) & 0xc0) === 0x80) return (b[at + 7] ?? 0) & 0x80 ? pts(b, at + 9) : null;
  let i = at + 6;
  while (b[i] === 0xff && i < at + 30) i++;
  if (((b[i] ?? 0) & 0xc0) === 0x40) i += 2;
  return ((b[i] ?? 0) & 0xe0) === 0x20 ? pts(b, i) : null;
}

/** Where a PES packet's payload starts. */
function pesPayload(/** @type {Uint8Array} */ b, /** @type {number} */ at) {
  if (((b[at + 6] ?? 0) & 0xc0) === 0x80) return at + 9 + (b[at + 8] ?? 0);
  let i = at + 6;
  while (b[i] === 0xff && i < at + 30) i++;
  if (((b[i] ?? 0) & 0xc0) === 0x40) i += 2;
  const marker = (b[i] ?? 0) & 0xf0;
  return i + (marker === 0x20 ? 5 : marker === 0x30 ? 10 : 1);
}

/** The duration between the earliest first and the latest last timestamp, wrap included. */
function span(/** @type {number | undefined} */ first, /** @type {number | undefined} */ last) {
  if (first === undefined || last === undefined) return undefined;
  const ticks = last >= first ? last - first : last + 2 ** 33 - first;
  return ticks / 90000;
}

/** A track from a video or audio payload's first bytes, as far as they say. */
function refine(/** @type {Track} */ track, /** @type {Uint8Array} */ payload) {
  if (track.codec === "H.264") Object.assign(track, annexBSize(payload) ?? {});
  else if (track.codec.startsWith("MPEG-") && track.kind === "video") {
    const seq = mpegVideoSize(payload);
    if (seq) {
      track.width = seq.width;
      track.height = seq.height;
      track.codec = seq.mpeg2 ? "MPEG-2 Video" : "MPEG-1 Video";
    }
  } else if (track.codec === "MPEG audio") {
    for (let i = 0; i + 4 < payload.length; i++) {
      const frame = frameAt(payload, i);
      if (!frame) continue;
      track.codec = frame.layer === 3 ? "MP3" : frame.layer === 2 ? "MP2" : "MP1";
      track.sampleRate = frame.rate;
      track.channels = frame.mono ? 1 : 2;
      break;
    }
  }
  return track;
}

/** @type {Read} */
export async function readMpegTs(source, head) {
  const step = head[0] === 0x47 ? 188 : 192;
  const skip = step === 188 ? 0 : 4;
  const bytes = await source.read(0, WINDOW);
  const tail = source.size > WINDOW ? await source.read(source.size - WINDOW, WINDOW) : bytes;
  /** The packets of a window: PID, payload unit start, payload. */
  const packets = function* (/** @type {Uint8Array} */ b) {
    let at = 0;
    while (at < step && b[at + skip] !== 0x47) at++;
    for (; at + step <= b.length; at += step) {
      const p = at + skip;
      if (b[p] !== 0x47) continue;
      const b1 = b[p + 1] ?? 0;
      const control = ((b[p + 3] ?? 0) >> 4) & 3;
      const start = p + 4 + (control & 2 ? 1 + (b[p + 4] ?? 0) : 0);
      if (!(control & 1) || start >= p + 188) continue;
      yield {
        pid: ((b1 & 0x1f) << 8) | (b[p + 2] ?? 0),
        unit: (b1 & 0x40) !== 0,
        payload: b.subarray(start, p + 188),
      };
    }
  };
  let pmt = -1;
  /** @type {Map<number, Track>} */
  const streams = new Map();
  /** @type {Map<number, number[]>} */
  const firstBytes = new Map();
  let first;
  for (const { pid, unit, payload } of packets(bytes)) {
    if (pid === 0 && unit && pmt < 0) {
      const t = 1 + (payload[0] ?? 0);
      for (
        let i = t + 8;
        i + 4 <= t + 3 + ((((payload[t + 1] ?? 0) & 15) << 8) | (payload[t + 2] ?? 0)) - 4;
        i += 4
      ) {
        if (((payload[i] ?? 0) << 8) + (payload[i + 1] ?? 0) === 0) continue;
        pmt = (((payload[i + 2] ?? 0) & 0x1f) << 8) | (payload[i + 3] ?? 0);
        break;
      }
    } else if (pid === pmt && unit && streams.size === 0) {
      const t = 1 + (payload[0] ?? 0);
      const end = t + 3 + ((((payload[t + 1] ?? 0) & 15) << 8) | (payload[t + 2] ?? 0)) - 4;
      let i = t + 12 + ((((payload[t + 10] ?? 0) & 15) << 8) | (payload[t + 11] ?? 0));
      while (i + 5 <= end) {
        const type = payload[i] ?? 0;
        const es = (((payload[i + 1] ?? 0) & 0x1f) << 8) | (payload[i + 2] ?? 0);
        const infoLength = (((payload[i + 3] ?? 0) & 15) << 8) | (payload[i + 4] ?? 0);
        let [kind, codec] = STREAM_TYPES[type] ?? ["other", `stream type 0x${type.toString(16)}`];
        let language = "";
        for (let d = i + 5; d + 2 <= i + 5 + infoLength; d += 2 + (payload[d + 1] ?? 0)) {
          const tag = payload[d] ?? 0;
          const body = payload.subarray(d + 2, d + 2 + (payload[d + 1] ?? 0));
          if (tag === 0x0a) language = latin1(body.subarray(0, 3));
          if (type !== 6) continue;
          if (tag === 0x6a) [kind, codec] = ["audio", "AC-3"];
          else if (tag === 0x7a) [kind, codec] = ["audio", "E-AC-3"];
          else if (tag === 0x7b) [kind, codec] = ["audio", "DTS"];
          else if (tag === 0x59) [kind, codec] = ["subtitle", "DVB subtitles"];
          else if (tag === 0x56) [kind, codec] = ["subtitle", "Teletext"];
          else if (tag === 0x05 && latin1(body.subarray(0, 4)) === "Opus")
            [kind, codec] = ["audio", "Opus"];
        }
        /** @type {Track} */
        const track = { kind, codec };
        if (language && language !== "und") track.language = language;
        streams.set(es, track);
        i += 5 + infoLength;
      }
    } else if (streams.has(pid)) {
      if (unit && payload[0] === 0 && payload[1] === 0 && payload[2] === 1) {
        const at = pesPts(payload, 0);
        if (at !== null && (first === undefined || at < first)) first = at;
        if (!firstBytes.has(pid))
          firstBytes.set(pid, [...payload.subarray(pesPayload(payload, 0))]);
      } else if (firstBytes.has(pid) && (firstBytes.get(pid)?.length ?? 0) < 16384)
        firstBytes.get(pid)?.push(...payload);
    }
  }
  if (streams.size === 0) throw new Error("This transport stream has no program map.");
  let last;
  for (const { pid, unit, payload } of packets(tail)) {
    if (!unit || !streams.has(pid) || payload[0] !== 0 || payload[1] !== 0 || payload[2] !== 1)
      continue;
    const at = pesPts(payload, 0);
    if (at !== null && (last === undefined || at > last)) last = at;
  }
  const tracks = [...streams].map(([pid, track]) =>
    refine(track, Uint8Array.from(firstBytes.get(pid) ?? [])),
  );
  return { duration: span(first, last), tracks: tracks.filter((t) => t.kind !== "other") };
}

/** @type {Read} */
export async function readMpegPs(source) {
  const bytes = await source.read(0, WINDOW);
  const tail = source.size > WINDOW ? await source.read(source.size - WINDOW, WINDOW) : bytes;
  /** @type {Map<string, { track: Track, payload: Uint8Array }>} */
  const streams = new Map();
  let first;
  let last;
  /** Every PES packet in a window: stream id, PTS, payload. */
  const each = (
    /** @type {Uint8Array} */ b,
    /** @type {(id: number, at: number) => void} */ visit,
  ) => {
    for (let i = 0; i + 6 < b.length; i++) {
      if (b[i] !== 0 || b[i + 1] !== 0 || b[i + 2] !== 1) continue;
      const id = b[i + 3] ?? 0;
      if (id === 0xbd || (id >= 0xc0 && id <= 0xef)) {
        visit(id, i);
        i += 5 + (((b[i + 4] ?? 0) << 8) | (b[i + 5] ?? 0));
      } else if (id === 0xbb || id === 0xbc || id === 0xbe || id === 0xbf)
        i += 5 + (((b[i + 4] ?? 0) << 8) | (b[i + 5] ?? 0));
    }
  };
  each(bytes, (id, at) => {
    const start = pesPayload(bytes, at);
    const end = at + 6 + (((bytes[at + 4] ?? 0) << 8) | (bytes[at + 5] ?? 0));
    const sub = id === 0xbd ? (bytes[start] ?? 0) : -1;
    const key = `${id}.${sub}`;
    const time = pesPts(bytes, at);
    if (time !== null && (first === undefined || time < first)) first = time;
    if (streams.has(key)) return;
    /** @type {Track} */
    let track;
    if (id >= 0xe0) track = { kind: "video", codec: "MPEG-2 Video" };
    else if (id >= 0xc0) track = { kind: "audio", codec: "MPEG audio" };
    else if (sub >= 0x80 && sub <= 0x87) track = { kind: "audio", codec: "AC-3" };
    else if (sub >= 0x88 && sub <= 0x8f) track = { kind: "audio", codec: "DTS" };
    else if (sub >= 0xa0 && sub <= 0xa7) track = { kind: "audio", codec: "LPCM" };
    else if (sub >= 0x20 && sub <= 0x3f) track = { kind: "subtitle", codec: "DVD subtitles" };
    else return;
    const payload = bytes.subarray(start, Math.min(bytes.length, end));
    if (id >= 0xe0 && !mpegVideoSize(payload) && annexBSize(payload)) track.codec = "H.264";
    streams.set(key, { track, payload });
  });
  each(tail, (_id, at) => {
    const time = pesPts(tail, at);
    if (time !== null && (last === undefined || time > last)) last = time;
  });
  if (streams.size === 0) throw new Error("This program stream holds no audio or video packets.");
  const tracks = [...streams.values()]
    .map(({ track, payload }) => refine(track, payload))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "video" ? -1 : 1));
  return { duration: span(first, last), tracks };
}
