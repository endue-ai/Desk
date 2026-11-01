// ID3 tags: ID3v2.2 to 2.4 (text frames, comments, the attached picture APIC or PIC) and ID3v1 at a
// file's end. MP3 files carry them, and AIFF, WAV and DSF files embed ID3v2 in a chunk.
import { imageType, latin1, utf8, utf16 } from "../bytes.js";

/**
 * @typedef {import("./index.js").Tags} Tags
 * @typedef {import("./index.js").Picture} Picture
 */

/** The ID3v1 genres, with Winamp's additions. */
export const GENRES =
  `Blues|Classic Rock|Country|Dance|Disco|Funk|Grunge|Hip-Hop|Jazz|Metal|New Age|Oldies|Other|Pop|R&B|
Rap|Reggae|Rock|Techno|Industrial|Alternative|Ska|Death Metal|Pranks|Soundtrack|Euro-Techno|Ambient|Trip-Hop|
Vocal|Jazz+Funk|Fusion|Trance|Classical|Instrumental|Acid|House|Game|Sound Clip|Gospel|Noise|Alternative Rock|
Bass|Soul|Punk|Space|Meditative|Instrumental Pop|Instrumental Rock|Ethnic|Gothic|Darkwave|Techno-Industrial|
Electronic|Pop-Folk|Eurodance|Dream|Southern Rock|Comedy|Cult|Gangsta|Top 40|Christian Rap|Pop/Funk|Jungle|
Native American|Cabaret|New Wave|Psychedelic|Rave|Showtunes|Trailer|Lo-Fi|Tribal|Acid Punk|Acid Jazz|Polka|
Retro|Musical|Rock & Roll|Hard Rock|Folk|Folk-Rock|National Folk|Swing|Fast Fusion|Bebop|Latin|Revival|Celtic|
Bluegrass|Avantgarde|Gothic Rock|Progressive Rock|Psychedelic Rock|Symphonic Rock|Slow Rock|Big Band|Chorus|
Easy Listening|Acoustic|Humour|Speech|Chanson|Opera|Chamber Music|Sonata|Symphony|Booty Bass|Primus|Porn Groove|
Satire|Slow Jam|Club|Tango|Samba|Folklore|Ballad|Power Ballad|Rhythmic Soul|Freestyle|Duet|Punk Rock|Drum Solo|
A Cappella|Euro-House|Dance Hall|Goa|Drum & Bass|Club-House|Hardcore|Terror|Indie|BritPop|Negerpunk|Polsk Punk|
Beat|Christian Gangsta Rap|Heavy Metal|Black Metal|Crossover|Contemporary Christian|Christian Rock|Merengue|
Salsa|Thrash Metal|Anime|JPop|Synthpop`
    .replace(/\n/g, "")
    .split("|");

/** "(13)", "13" and "(13)Pop" name genre 13; anything else is the genre's own name. */
export function genreOf(/** @type {string} */ text) {
  const numbered = /^\((\d+)\)(.*)$/.exec(text) ?? /^(\d+)()$/.exec(text);
  if (!numbered) return text;
  return numbered[2] || GENRES[Number(numbered[1])] || text;
}

const syncsafe = (/** @type {Uint8Array} */ b, /** @type {number} */ at) =>
  (((b[at] ?? 0) & 127) << 21) |
  (((b[at + 1] ?? 0) & 127) << 14) |
  (((b[at + 2] ?? 0) & 127) << 7) |
  ((b[at + 3] ?? 0) & 127);
const be32 = (/** @type {Uint8Array} */ b, /** @type {number} */ at) =>
  (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>>
  0;

/** The bytes with unsynchronisation undone: every 0xFF 0x00 is a 0xFF. */
function resync(/** @type {Uint8Array} */ bytes) {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[n++] = bytes[i] ?? 0;
    if (bytes[i] === 0xff && bytes[i + 1] === 0) i++;
  }
  return out.subarray(0, n);
}

/** The size of an ID3v2 tag from its header, footer included; 0 when `bytes` does not start one. */
export function id3Size(/** @type {Uint8Array} */ bytes) {
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  return 10 + syncsafe(bytes, 6) + ((bytes[5] ?? 0) & 0x10 ? 10 : 0);
}

/** Text in one of ID3's four encodings. */
function decode(/** @type {number} */ encoding, /** @type {Uint8Array} */ bytes) {
  const text =
    encoding === 1
      ? utf16(bytes)
      : encoding === 2
        ? utf16(bytes, false)
        : encoding === 3
          ? utf8(bytes)
          : latin1(bytes);
  return text.replace(/\0+$/, "");
}

/** Where a NUL-terminated string in `encoding` ends at or after `from`, and where the rest starts. */
function terminator(/** @type {number} */ encoding, /** @type {Uint8Array} */ bytes, from = 0) {
  const wide = encoding === 1 || encoding === 2;
  for (let i = from; i < bytes.length; i += wide ? 2 : 1) {
    if (bytes[i] === 0 && (!wide || bytes[i + 1] === 0))
      return { end: i, next: i + (wide ? 2 : 1) };
  }
  return { end: bytes.length, next: bytes.length };
}

/**
 * An ID3v2 tag: `bytes` starts with "ID3" and holds the whole tag.
 * @param {Uint8Array} bytes
 * @returns {{ tags: Tags, cover?: Picture }}
 */
export function readId3v2(bytes) {
  const version = bytes[3] ?? 0;
  const flags = bytes[5] ?? 0;
  const end = Math.min(bytes.length, 10 + syncsafe(bytes, 6));
  let body = bytes.subarray(10, end);
  if (flags & 0x80 && version < 4) body = resync(body);
  let at = 0;
  if (flags & 0x40 && version === 3) at = 4 + be32(body, 0);
  if (flags & 0x40 && version === 4) at = syncsafe(body, 0);
  /** @type {Tags} */
  const tags = {};
  /** @type {Picture | undefined} */
  let cover;
  let coverIsFront = false;
  const idLength = version === 2 ? 3 : 4;
  const headerLength = version === 2 ? 6 : 10;
  while (at + headerLength <= body.length) {
    const id = latin1(body.subarray(at, at + idLength));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let size;
    if (version === 2)
      size = ((body[at + 3] ?? 0) << 16) | ((body[at + 4] ?? 0) << 8) | (body[at + 5] ?? 0);
    else if (version === 4 && [0, 1, 2, 3].every((i) => ((body[at + 4 + i] ?? 0) & 0x80) === 0))
      size = syncsafe(body, at + 4);
    else size = be32(body, at + 4);
    const format = version === 2 ? 0 : (body[at + 9] ?? 0);
    let data = body.subarray(at + headerLength, Math.min(body.length, at + headerLength + size));
    at += headerLength + size;
    if (version === 4) {
      if (format & 0x40) data = data.subarray(1);
      if (format & 0x01) data = data.subarray(4);
      if (format & 0x02 || flags & 0x80) data = resync(data);
      if (format & 0x0c) continue;
    } else if (version === 3) {
      if (format & 0xc0) continue;
      if (format & 0x20) data = data.subarray(1);
    }
    if (data.length === 0) continue;
    const encoding = data[0] ?? 0;
    const name = version === 2 ? (V22[id] ?? id) : id;
    if (name.startsWith("T") && name !== "TXXX") {
      const text = decode(encoding, data.subarray(1)).split("\0")[0]?.trim() ?? "";
      if (!text) continue;
      if (name === "TIT2") tags.title = text;
      else if (name === "TPE1") tags.artist = text;
      else if (name === "TPE2") tags.albumArtist = text;
      else if (name === "TALB") tags.album = text;
      else if (name === "TYER" || name === "TDRC") tags.year = text.slice(0, 4);
      else if (name === "TRCK") tags.track = text.split("/")[0];
      else if (name === "TCON") tags.genre = genreOf(text);
    } else if (name === "COMM" && !tags.comment) {
      const { next } = terminator(encoding, data, 4);
      const text = decode(encoding, data.subarray(next)).trim();
      if (text) tags.comment = text;
    } else if (name === "APIC" || id === "PIC") {
      let mime;
      let rest;
      if (id === "PIC") {
        const format3 = latin1(data.subarray(1, 4)).toUpperCase();
        mime = format3 === "PNG" ? "image/png" : "image/jpeg";
        rest = 4;
      } else {
        const nul = data.indexOf(0, 1);
        mime = latin1(data.subarray(1, nul < 0 ? 1 : nul)).toLowerCase();
        rest = nul < 0 ? data.length : nul + 1;
      }
      const front = data[rest] === 3;
      const { next } = terminator(encoding, data, rest + 1);
      const image = data.slice(next);
      if (image.length > 0 && (!cover || (front && !coverIsFront))) {
        const known = mime.includes("/") ? mime.replace("image/jpg", "image/jpeg") : "image/jpeg";
        cover = { type: imageType(image, known), bytes: image };
        coverIsFront = front;
      }
    }
  }
  return { tags, cover };
}

/** ID3v2.2's three-letter frames, as their ID3v2.3 names. */
const V22 = /** @type {Record<string, string>} */ ({
  TT2: "TIT2",
  TP1: "TPE1",
  TP2: "TPE2",
  TAL: "TALB",
  TYE: "TYER",
  TRK: "TRCK",
  TCO: "TCON",
  COM: "COMM",
});

/**
 * An ID3v1 tag: the last 128 bytes of the file, starting with "TAG".
 * @param {Uint8Array} bytes
 * @returns {Tags | null}
 */
export function readId3v1(bytes) {
  if (bytes.length < 128 || latin1(bytes.subarray(0, 3)) !== "TAG") return null;
  const field = (/** @type {number} */ from, /** @type {number} */ length) => {
    const raw = bytes.subarray(from, from + length);
    const nul = raw.indexOf(0);
    return latin1(nul < 0 ? raw : raw.subarray(0, nul)).trim();
  };
  /** @type {Tags} */
  const tags = {};
  const set = (/** @type {keyof Tags} */ key, /** @type {string} */ value) => {
    if (value) tags[key] = value;
  };
  set("title", field(3, 30));
  set("artist", field(33, 30));
  set("album", field(63, 30));
  set("year", field(93, 4));
  set("comment", field(97, bytes[125] === 0 ? 28 : 30));
  if (bytes[125] === 0 && (bytes[126] ?? 0) > 0) tags.track = String(bytes[126]);
  const genre = GENRES[bytes[127] ?? 255];
  if (genre) tags.genre = genre;
  return tags;
}
