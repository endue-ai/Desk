// Monkey's Audio (APE) and WavPack headers, and the APEv2 tags both keep at the end of the file
// (before an ID3v1 tag when there is one), with a cover in "Cover Art (Front)".
import { Cursor, imageType, latin1, startsWith, utf8 } from "../bytes.js";
import { readId3v1 } from "./id3.js";

/**
 * @typedef {import("./index.js").Read} Read
 * @typedef {import("./index.js").Tags} Tags
 * @typedef {import("../source.js").Source} Source
 */

const NAMES = /** @type {Record<string, keyof Tags>} */ ({
  title: "title",
  artist: "artist",
  album: "album",
  "album artist": "albumArtist",
  albumartist: "albumArtist",
  year: "year",
  genre: "genre",
  track: "track",
  comment: "comment",
});

/** The APEv2 tag at the end of the file, or the ID3v1 tag, as tags and a cover. */
export async function apeTags(/** @type {Source} */ source) {
  const tail = await source.read(Math.max(0, source.size - 160), 160);
  const v1 = readId3v1(tail.subarray(tail.length - 128));
  const footerAt = tail.length - (v1 ? 128 : 0) - 32;
  /** @type {Tags} */
  const tags = { ...v1 };
  /** @type {import("./index.js").Picture | undefined} */
  let cover;
  if (footerAt < 0 || !startsWith(tail, "APETAGEX", footerAt)) return { tags, cover };
  const f = new Cursor(tail, footerAt + 8, true);
  f.skip(4);
  const size = f.u32();
  const count = f.u32();
  const end = source.size - (v1 ? 128 : 0) - 32;
  const items = await source.read(end - (size - 32), Math.min(size - 32, 1 << 24));
  const c = new Cursor(items, 0, true);
  for (let i = 0; i < count && c.left > 8; i++) {
    const length = c.u32();
    const flags = c.u32();
    const nul = items.indexOf(0, c.pos);
    if (nul < 0) break;
    const key = latin1(items.subarray(c.pos, nul));
    c.pos = nul + 1;
    const value = c.take(length);
    const binary = (flags >> 1) & 3;
    if (binary === 1 && /^cover art/i.test(key) && !cover) {
      const zero = value.indexOf(0);
      const image = value.slice(zero + 1);
      if (image.length > 0) cover = { type: imageType(image), bytes: image };
      continue;
    }
    const name = NAMES[key.toLowerCase()];
    if (name && binary === 0) tags[name] = utf8(value).split("\0")[0] ?? "";
  }
  if (tags.year) tags.year = tags.year.slice(0, 4);
  if (tags.track) tags.track = tags.track.split("/")[0];
  return { tags, cover };
}

/** @type {Read} */
export async function readApe(source, head) {
  const c = new Cursor(head, 4, true);
  const version = c.u16();
  let compression;
  let blocksPerFrame;
  let finalBlocks;
  let frames;
  let bits;
  let channels;
  let rate;
  if (version >= 3980) {
    c.skip(2);
    const descriptorBytes = c.u32();
    const h = new Cursor(head, descriptorBytes, true);
    compression = h.u16();
    h.skip(2);
    blocksPerFrame = h.u32();
    finalBlocks = h.u32();
    frames = h.u32();
    bits = h.u16();
    channels = h.u16();
    rate = h.u32();
  } else {
    compression = c.u16();
    const flags = c.u16();
    channels = c.u16();
    rate = c.u32();
    c.skip(8);
    frames = c.u32();
    finalBlocks = c.u32();
    bits = flags & 1 ? 8 : flags & 8 ? 24 : 16;
    blocksPerFrame =
      version >= 3950
        ? 73728 * 4
        : version >= 3900 || (version >= 3800 && compression === 4000)
          ? 73728
          : 9216;
  }
  if (!rate) throw new Error("The Monkey's Audio header is damaged.");
  const samples = frames > 0 ? (frames - 1) * blocksPerFrame + finalBlocks : 0;
  const { tags, cover } = await apeTags(source);
  return {
    duration: samples / rate,
    tracks: [{ kind: "audio", codec: "Monkey's Audio", channels, sampleRate: rate, bits }],
    tags,
    cover,
  };
}

const WV_RATES = [
  6000, 8000, 9600, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000,
  192000,
];

/** @type {Read} */
export async function readWavPack(source, head) {
  const c = new Cursor(head, 12, true);
  const total = c.u32();
  c.skip(8);
  const flags = c.u32();
  const rate = WV_RATES[(flags >> 23) & 15] ?? 44100;
  const bits = ((flags & 3) + 1) * 8;
  const channels = flags & 4 ? 1 : 2;
  const { tags, cover } = await apeTags(source);
  return {
    duration: total > 0 && total !== 0xffffffff ? total / rate : undefined,
    tracks: [{ kind: "audio", codec: "WavPack", channels, sampleRate: rate, bits }],
    tags,
    cover,
  };
}
