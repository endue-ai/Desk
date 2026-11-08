// FLV: the onMetaData script tag (AMF0) gives the duration, dimensions and codec ids; the first audio
// and video tags give the codecs when the metadata does not, and an AVC sequence header the size.
import { Cursor, utf8 } from "../bytes.js";
import { spsSize } from "./h264.js";

/**
 * @typedef {import("./index.js").Read} Read
 * @typedef {import("./index.js").Track} Track
 */

const VIDEO = {
  2: "Sorenson Spark",
  3: "Screen Video",
  4: "VP6",
  5: "VP6",
  6: "Screen Video 2",
  7: "H.264",
  12: "HEVC",
};
const AUDIO = {
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
};
const RATES = [5512, 11025, 22050, 44100];

/** One AMF0 value at the cursor; objects and arrays become plain objects. */
function amf(/** @type {Cursor} */ c, depth = 0) {
  const type = c.u8();
  const string = () => utf8(c.take(c.u16()));
  /** @returns {Record<string, unknown>} */
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
    const time = c.f64();
    c.skip(2);
    return time;
  }
  if (type === 12) return utf8(c.take(c.u32()));
  return undefined;
}

/** @type {Read} */
export async function readFlv(source, head) {
  const c = new Cursor(head, 5);
  const offset = c.u32();
  const bytes = await source.read(0, Math.min(source.size, 1 << 20));
  /** @type {Record<string, unknown>} */
  let meta = {};
  /** @type {number | undefined} */
  let audioTag;
  /** @type {number | undefined} */
  let videoTag;
  /** @type {{ rate: number, channels: number } | undefined} */
  let audioFormat;
  /** @type {{ width: number, height: number } | null} */
  let avcSize = null;
  for (let at = offset + 4, n = 0; at + 11 <= bytes.length && n < 200; n++) {
    const t = new Cursor(bytes, at);
    const type = t.u8() & 0x1f;
    const size = t.u24();
    const data = bytes.subarray(at + 11, at + 11 + size);
    if (type === 18 && Object.keys(meta).length === 0) {
      const m = new Cursor(data);
      if (amf(m) === "onMetaData") {
        const value = amf(m);
        if (value && typeof value === "object")
          meta = /** @type {Record<string, unknown>} */ (value);
      }
    } else if (type === 8 && audioTag === undefined && data.length > 0) {
      const first = data[0] ?? 0;
      audioTag = first >> 4;
      audioFormat = { rate: RATES[(first >> 2) & 3] ?? 0, channels: first & 1 ? 2 : 1 };
    } else if (type === 9 && videoTag === undefined && data.length > 0) {
      videoTag = (data[0] ?? 0) & 0x0f;
      if (videoTag === 7 && data[1] === 0 && data.length > 16) {
        const spsLength = ((data[11] ?? 0) << 8) | (data[12] ?? 0);
        avcSize = spsSize(data.subarray(13, 13 + spsLength));
      }
    }
    if (audioTag !== undefined && videoTag !== undefined && Object.keys(meta).length > 0) break;
    at += 11 + size + 4;
  }
  const num = (/** @type {string} */ key) =>
    typeof meta[key] === "number" ? Number(meta[key]) : undefined;
  /** @type {Track[]} */
  const tracks = [];
  const videoId = num("videocodecid") ?? videoTag;
  if (videoId !== undefined) {
    const name = /** @type {Record<number, string>} */ (VIDEO)[videoId] ?? `codec ${videoId}`;
    tracks.push({
      kind: "video",
      codec: name,
      width: num("width") || avcSize?.width,
      height: num("height") || avcSize?.height,
    });
  }
  const audioId = num("audiocodecid") ?? audioTag;
  if (audioId !== undefined) {
    const name = /** @type {Record<number, string>} */ (AUDIO)[audioId] ?? `codec ${audioId}`;
    const stereo = typeof meta.stereo === "boolean" ? (meta.stereo ? 2 : 1) : audioFormat?.channels;
    tracks.push({
      kind: "audio",
      codec: name,
      sampleRate: num("audiosamplerate") || audioFormat?.rate,
      channels: stereo,
    });
  }
  const title = typeof meta.title === "string" ? meta.title : undefined;
  return { duration: num("duration"), tracks, tags: title ? { title } : {} };
}
