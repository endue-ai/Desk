// MPEG audio: MP3 (and MP1, MP2) with its ID3v2 tag at the start and ID3v1 at the end, the duration
// from a Xing, Info or VBRI header or else the bit rate; and AAC in ADTS frames.
import { Cursor, latin1 } from "../bytes.js";
import { id3Size, readId3v1, readId3v2 } from "./id3.js";

/** @typedef {import("./index.js").Read} Read */

const RATES = [
  [11025, 12000, 8000],
  [0, 0, 0],
  [22050, 24000, 16000],
  [44100, 48000, 32000],
];
const KBPS = {
  "3-3": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "3-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "3-1": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-3": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

/**
 * One MPEG audio frame header at `at`, or null.
 * @param {Uint8Array} b
 * @param {number} at
 */
export function frameAt(b, at) {
  if (b[at] !== 0xff || ((b[at + 1] ?? 0) & 0xe0) !== 0xe0) return null;
  const b1 = b[at + 1] ?? 0;
  const b2 = b[at + 2] ?? 0;
  const version = (b1 >> 3) & 3;
  const layer = 4 - ((b1 >> 1) & 3);
  const rate = RATES[version]?.[(b2 >> 2) & 3] ?? 0;
  if (version === 1 || layer === 4 || !rate) return null;
  const table = /** @type {Record<string, number[]>} */ (KBPS)[
    `${version === 3 ? 3 : 2}-${version === 3 ? 4 - layer : layer === 1 ? 3 : 2}`
  ];
  const kbps = table?.[b2 >> 4] ?? 0;
  if (!kbps) return null;
  const pad = (b2 >> 1) & 1;
  const mono = (b[at + 3] ?? 0) >> 6 === 3;
  const samples = layer === 1 ? 384 : layer === 3 && version !== 3 ? 576 : 1152;
  const length =
    layer === 1
      ? Math.floor((12 * kbps * 1000) / rate + pad) * 4
      : Math.floor(((samples / 8) * kbps * 1000) / rate) + pad;
  return { version, layer, rate, kbps, mono, samples, length };
}

/** The first frame at or after `from` that another frame follows (or the data ends after). */
function firstFrame(/** @type {Uint8Array} */ b, /** @type {number} */ from) {
  for (let at = from; at + 4 <= b.length; at++) {
    const frame = frameAt(b, at);
    if (!frame) continue;
    const next = at + frame.length;
    if (next + 4 > b.length || frameAt(b, next)) return { at, frame };
  }
  return null;
}

/** @type {Read} */
export async function readMp3(source, head) {
  const tagSize = id3Size(head);
  const { tags, cover } = tagSize
    ? readId3v2(await source.read(0, Math.min(tagSize, 1 << 24)))
    : { tags: {}, cover: undefined };
  const tail = source.size >= 128 ? await source.read(source.size - 128, 128) : new Uint8Array(0);
  const v1 = readId3v1(tail);
  const start = tagSize;
  const window = await source.read(start, 64 * 1024);
  const found = firstFrame(window, 0);
  if (!found)
    throw new Error("No MPEG audio frame follows the tag: the file is damaged or not MP3.");
  const { at, frame } = found;
  const codec = frame.layer === 3 ? "MP3" : frame.layer === 2 ? "MP2" : "MP1";
  let duration;
  const side = frame.version === 3 ? (frame.mono ? 21 : 36) : frame.mono ? 13 : 21;
  const c = new Cursor(window, at + side);
  const xing = latin1(window.subarray(at + side, at + side + 4));
  if (xing === "Xing" || xing === "Info") {
    c.skip(4);
    const flags = c.u32();
    if (flags & 1) duration = (c.u32() * frame.samples) / frame.rate;
  } else if (latin1(window.subarray(at + 36, at + 40)) === "VBRI") {
    const v = new Cursor(window, at + 36 + 10);
    v.skip(4);
    duration = (v.u32() * frame.samples) / frame.rate;
  }
  if (!duration) {
    const audio = source.size - start - at - (v1 ? 128 : 0);
    duration = (audio * 8) / (frame.kbps * 1000);
  }
  return {
    duration,
    tracks: [
      {
        kind: "audio",
        codec,
        codecId: "mp3",
        sampleRate: frame.rate,
        channels: frame.mono ? 1 : 2,
      },
    ],
    tags: { ...v1, ...tags },
    cover,
  };
}

const AAC_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

/** @type {Read} */
export async function readAac(source, head) {
  const tagSize = id3Size(head);
  const { tags } = tagSize
    ? readId3v2(await source.read(0, Math.min(tagSize, 1 << 24)))
    : { tags: {} };
  const bytes = await source.read(tagSize, 1 << 20);
  let at = 0;
  while (at < bytes.length && !(bytes[at] === 0xff && ((bytes[at + 1] ?? 0) & 0xf6) === 0xf0)) at++;
  const first = at;
  const b2 = bytes[at + 2] ?? 0;
  const profile = b2 >> 6;
  const rate = AAC_RATES[(b2 >> 2) & 15] ?? 0;
  const channels = ((b2 & 1) << 2) | ((bytes[at + 3] ?? 0) >> 6);
  if (!rate) throw new Error("No ADTS frame starts the file: it is damaged or not AAC.");
  let frames = 0;
  while (at + 7 <= bytes.length && bytes[at] === 0xff && ((bytes[at + 1] ?? 0) & 0xf6) === 0xf0) {
    const length =
      (((bytes[at + 3] ?? 0) & 3) << 11) |
      ((bytes[at + 4] ?? 0) << 3) |
      ((bytes[at + 5] ?? 0) >> 5);
    if (length < 7) break;
    frames += 1 + ((bytes[at + 6] ?? 0) & 3);
    at += length;
  }
  const walked = Math.max(1, at - first);
  const total = source.size - tagSize - first;
  const estimate = at >= bytes.length || at >= total ? frames : (frames * total) / walked;
  const aot = profile + 1;
  return {
    duration: (estimate * 1024) / rate,
    tracks: [
      {
        kind: "audio",
        codec: aot === 2 ? "AAC" : `AAC (profile ${profile})`,
        codecId: `mp4a.40.${aot}`,
        sampleRate: rate,
        channels: channels || undefined,
      },
    ],
    tags,
  };
}
