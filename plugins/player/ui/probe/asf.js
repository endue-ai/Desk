// ASF (WMV, WMA, ASF): everything is in the header object at the start: the duration in File
// Properties, each stream's type and codec in Stream Properties, the title and author in Content
// Description, the album, year and cover (WM/Picture) in Extended Content Description.
import { Cursor, imageType, latin1, utf16 } from "../bytes.js";
import { fourccCodec, waveCodec } from "../codecs.js";
import { GENRES } from "./id3.js";

/**
 * @typedef {import("./index.js").Read} Read
 * @typedef {import("./index.js").Track} Track
 * @typedef {import("./index.js").Tags} Tags
 */

const GUID = {
  header: "75B22630-668E-11CF-A6D9-00AA0062CE6C",
  file: "8CABDCA1-A947-11CF-8EE4-00C00C205365",
  stream: "B7DC0791-A9B7-11CF-8EE6-00C00C205365",
  content: "75B22633-668E-11CF-A6D9-00AA0062CE6C",
  extended: "D2D0A440-E307-11D2-97F0-00A0C95EA850",
  headerExtension: "5FBF03B5-A92E-11CF-8EE3-00C00C205365",
  audio: "F8699E40-5B4D-11CF-A8FD-00805F5C442B",
  video: "BC19EFC0-5B4D-11CF-A8FD-00805F5C442B",
};

/** A GUID as written in ASF (the first three fields little-endian), in its usual text form. */
function guid(/** @type {Uint8Array} */ b, /** @type {number} */ at) {
  const hex = (/** @type {number[]} */ bytes) =>
    bytes.map((x) => x.toString(16).toUpperCase().padStart(2, "0")).join("");
  const g = [...b.subarray(at, at + 16)];
  if (g.length < 16) return "";
  return [
    hex([g[3] ?? 0, g[2] ?? 0, g[1] ?? 0, g[0] ?? 0]),
    hex([g[5] ?? 0, g[4] ?? 0]),
    hex([g[7] ?? 0, g[6] ?? 0]),
    hex(g.slice(8, 10)),
    hex(g.slice(10, 16)),
  ].join("-");
}

/** The objects in [start, end) of the header: GUID, where the content starts, where it ends. */
function objects(
  /** @type {Uint8Array} */ b,
  /** @type {number} */ start,
  /** @type {number} */ end,
) {
  const out = [];
  for (let at = start; at + 24 <= end && out.length < 256; ) {
    const size = new Cursor(b, at + 16, true).u64();
    if (size < 24) break;
    out.push({ id: guid(b, at), at: at + 24, end: Math.min(end, at + size) });
    at += size;
  }
  return out;
}

const text16 = (/** @type {Uint8Array} */ bytes) => utf16(bytes, true).replace(/\0+$/, "").trim();

/** Extended content descriptors: WM/AlbumTitle, WM/Year, WM/Genre, WM/Picture, ... */
function descriptors(
  /** @type {Uint8Array} */ b,
  /** @type {number} */ at,
  /** @type {number} */ end,
) {
  /** @type {Tags} */
  const tags = {};
  /** @type {import("./index.js").Picture | undefined} */
  let cover;
  const c = new Cursor(b, at, true);
  const count = c.u16();
  for (let i = 0; i < count && c.pos < end; i++) {
    const name = text16(c.take(c.u16()));
    const type = c.u16();
    const value = c.take(c.u16());
    const v = new Cursor(value, 0, true);
    const asText = () =>
      type === 0 ? text16(value) : type === 3 ? String(v.u32()) : type === 5 ? String(v.u16()) : "";
    if (name === "WM/AlbumTitle") tags.album = asText();
    else if (name === "WM/AlbumArtist") tags.albumArtist = asText();
    else if (name === "WM/Year") tags.year = asText().slice(0, 4);
    else if (name === "WM/Genre") tags.genre = asText();
    else if (name === "WM/GenreID" && !tags.genre) tags.genre = GENRES[Number(asText())] ?? "";
    else if (name === "WM/TrackNumber") tags.track = asText();
    else if (name === "WM/Picture" && type === 1 && !cover) {
      v.skip(1);
      const length = v.u32();
      let p = v.pos;
      for (let n = 0; n < 2; n++) {
        while (p + 1 < value.length && (value[p] !== 0 || value[p + 1] !== 0)) p += 2;
        p += 2;
      }
      const bytes = value.slice(p, p + length);
      if (bytes.length > 0) cover = { type: imageType(bytes), bytes };
    }
  }
  return { tags, cover };
}

/** @type {Read} */
export async function readAsf(source, head) {
  const size = new Cursor(head, 16, true).u64();
  const b = size <= head.length ? head : await source.read(0, Math.min(size, 1 << 24));
  if (guid(b, 0) !== GUID.header) throw new Error("The ASF header object is damaged.");
  const end = Math.min(b.length, size);
  let list = objects(b, 30, end);
  const extension = list.find((o) => o.id === GUID.headerExtension);
  if (extension) list = [...list, ...objects(b, extension.at + 22, extension.end)];
  let duration;
  /** @type {Track[]} */
  const tracks = [];
  /** @type {Tags} */
  let tags = {};
  /** @type {import("./index.js").Picture | undefined} */
  let cover;
  for (const object of list) {
    const c = new Cursor(b, object.at, true);
    if (object.id === GUID.file) {
      c.skip(40);
      const play = c.u64();
      c.skip(8);
      const preroll = c.u64();
      duration = Math.max(0, play / 1e7 - preroll / 1000);
    } else if (object.id === GUID.stream) {
      const type = guid(b, object.at);
      const data = object.at + 54;
      if (type === GUID.audio) {
        const a = new Cursor(b, data, true);
        const tag = a.u16();
        const channels = a.u16();
        const sampleRate = a.u32();
        tracks.push({ kind: "audio", codec: waveCodec(tag), channels, sampleRate });
      } else if (type === GUID.video) {
        const v = new Cursor(b, data, true);
        const width = v.u32();
        const height = v.u32();
        const fourcc = latin1(b.subarray(data + 27, data + 31));
        tracks.push({ kind: "video", codec: fourccCodec(fourcc), codecId: fourcc, width, height });
      }
    } else if (object.id === GUID.content) {
      const lengths = [c.u16(), c.u16(), c.u16(), c.u16(), c.u16()];
      const [title = "", author = "", , description = ""] = lengths.map((n) => text16(c.take(n)));
      if (title) tags.title = title;
      if (author) tags.artist = author;
      if (description) tags.comment = description;
    } else if (object.id === GUID.extended) {
      const found = descriptors(b, object.at, object.end);
      tags = { ...found.tags, ...tags };
      cover = found.cover;
    }
  }
  // Video first, as every other reader lists them.
  tracks.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "video" ? -1 : 1));
  return { duration, tracks, tags, cover };
}
