// Vorbis comments (Ogg Vorbis, Opus, Theora, FLAC) and the FLAC picture block, which Ogg files carry
// base64-encoded in METADATA_BLOCK_PICTURE.
import { Cursor, fromBase64, imageType, latin1, utf8 } from "../bytes.js";

/**
 * @typedef {import("./index.js").Tags} Tags
 * @typedef {import("./index.js").Picture} Picture
 */

/**
 * A FLAC PICTURE block's content: type, MIME, description, size, the image.
 * @param {Uint8Array} bytes
 * @returns {Picture & { front: boolean } | null}
 */
export function flacPicture(bytes) {
  const c = new Cursor(bytes);
  const type = c.u32();
  const mime = latin1(c.take(c.u32()));
  c.skip(c.u32());
  c.skip(16);
  const image = c.take(c.u32()).slice();
  if (image.length === 0) return null;
  return { type: imageType(image, mime || "image/jpeg"), bytes: image, front: type === 3 };
}

const NAMES = /** @type {Record<string, keyof Tags>} */ ({
  TITLE: "title",
  ARTIST: "artist",
  ALBUM: "album",
  ALBUMARTIST: "albumArtist",
  "ALBUM ARTIST": "albumArtist",
  DATE: "year",
  YEAR: "year",
  GENRE: "genre",
  TRACKNUMBER: "track",
  COMMENT: "comment",
  DESCRIPTION: "comment",
});

/**
 * A Vorbis comment block: vendor string, then KEY=value fields (little-endian lengths).
 * @param {Uint8Array} bytes
 * @returns {{ tags: Tags, cover?: Picture }}
 */
export function vorbisComments(bytes) {
  const c = new Cursor(bytes, 0, true);
  c.skip(c.u32());
  const count = c.u32();
  /** @type {Tags} */
  const tags = {};
  /** @type {(Picture & { front: boolean }) | null} */
  let cover = null;
  for (let i = 0; i < count && c.left >= 4; i++) {
    const field = c.take(c.u32());
    const eq = field.indexOf(0x3d);
    if (eq < 0) continue;
    const key = latin1(field.subarray(0, eq)).toUpperCase();
    const value = field.subarray(eq + 1);
    if (key === "METADATA_BLOCK_PICTURE" || key === "COVERART") {
      try {
        const decoded = fromBase64(latin1(value));
        const picture =
          key === "COVERART"
            ? { type: imageType(decoded), bytes: decoded, front: true }
            : flacPicture(decoded);
        if (picture && (!cover || (picture.front && !cover.front))) cover = picture;
      } catch {
        // A picture that is not base64 is skipped; the rest of the comments still count.
      }
      continue;
    }
    const name = NAMES[key];
    if (!name || tags[name]) continue;
    const text = utf8(value).trim();
    tags[name] =
      name === "year" ? text.slice(0, 4) : name === "track" ? (text.split("/")[0] ?? text) : text;
  }
  return cover ? { tags, cover: { type: cover.type, bytes: cover.bytes } } : { tags };
}
