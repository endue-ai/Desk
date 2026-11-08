// FLAC: STREAMINFO (rate, channels, bits, samples), the Vorbis comment block and the PICTURE block.
// Blocks are walked by their headers; a large picture is read in one range, the audio never.
import { Cursor, startsWith } from "../bytes.js";
import { id3Size, readId3v2 } from "./id3.js";
import { flacPicture, vorbisComments } from "./vorbis.js";

/** @typedef {import("./index.js").Read} Read */

/** STREAMINFO's sample rate, channels, bits per sample and total samples. */
export function streamInfo(/** @type {Uint8Array} */ b) {
  const at = (/** @type {number} */ i) => b[i] ?? 0;
  const rate = (at(10) << 12) | (at(11) << 4) | (at(12) >> 4);
  const channels = ((at(12) >> 1) & 7) + 1;
  const bits = (((at(12) & 1) << 4) | (at(13) >> 4)) + 1;
  const samples = (at(13) & 15) * 2 ** 32 + new Cursor(b, 14).u32();
  return { rate, channels, bits, samples };
}

/** @type {Read} */
export async function readFlac(source, head) {
  const tag = id3Size(head);
  const id3 = tag ? readId3v2(await source.read(0, Math.min(tag, 1 << 24))) : null;
  let at = tag;
  while (at < head.length && head[at] === 0) at++;
  if (!startsWith(await source.read(at, 4), "fLaC"))
    throw new Error("The FLAC stream marker is missing.");
  at += 4;
  let info;
  let found = id3 ?? { tags: {}, cover: undefined };
  let pictured = false;
  for (let n = 0; n < 128 && at + 4 <= source.size; n++) {
    const h = new Cursor(await source.read(at, 4));
    const first = h.u8();
    const length = h.u24();
    const type = first & 0x7f;
    if (type === 0) info = streamInfo(await source.read(at + 4, 34));
    else if (type === 4) {
      const comments = vorbisComments(await source.read(at + 4, Math.min(length, 1 << 24)));
      found = { tags: { ...found.tags, ...comments.tags }, cover: found.cover ?? comments.cover };
    } else if (type === 6 && !pictured && length <= 1 << 24) {
      const picture = flacPicture(await source.read(at + 4, length));
      if (picture && (!found.cover || picture.front)) {
        found = { ...found, cover: { type: picture.type, bytes: picture.bytes } };
        pictured = picture.front;
      }
    }
    at += 4 + length;
    if (first & 0x80) break;
  }
  if (!info) throw new Error("The FLAC stream has no STREAMINFO block.");
  return {
    duration: info.rate > 0 && info.samples > 0 ? info.samples / info.rate : undefined,
    tracks: [
      {
        kind: "audio",
        codec: "FLAC",
        codecId: "flac",
        channels: info.channels,
        sampleRate: info.rate,
        bits: info.bits,
      },
    ],
    tags: found.tags,
    cover: found.cover,
  };
}
