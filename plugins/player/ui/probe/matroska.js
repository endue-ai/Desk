// Matroska and WebM (EBML): the duration from Info, each track's type, codec id, language and
// dimensions from Tracks, the file's tags, chapters and a cover among its attachments. The segment's
// top-level elements are walked by their headers up to the first cluster; the SeekHead finds the
// rest (tags written at the end, say) without reading the clusters.
import { Cursor, imageType, latin1, utf8 } from "../bytes.js";
import { fourccCodec, matroskaCodec, waveCodec } from "../codecs.js";

/**
 * @typedef {import("./index.js").Read} Read
 * @typedef {import("./index.js").Track} Track
 * @typedef {import("./index.js").Tags} Tags
 * @typedef {{ id: number, at: number, size: number, end: number }} Element
 */

const ID = {
  ebml: 0x1a45dfa3,
  docType: 0x4282,
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  info: 0x1549a966,
  scale: 0x2ad7b1,
  duration: 0x4489,
  title: 0x7ba9,
  tracks: 0x1654ae6b,
  entry: 0xae,
  type: 0x83,
  codec: 0x86,
  privateData: 0x63a2,
  language: 0x22b59c,
  bcp47: 0x22b59d,
  name: 0x536e,
  video: 0xe0,
  width: 0xb0,
  height: 0xba,
  audio: 0xe1,
  rate: 0xb5,
  channels: 0x9f,
  depth: 0x6264,
  encodings: 0x6d80,
  encoding: 0x6240,
  encryption: 0x5035,
  tags: 0x1254c367,
  tag: 0x7373,
  targets: 0x63c0,
  targetType: 0x68ca,
  trackUid: 0x63c5,
  simple: 0x67c8,
  tagName: 0x45a3,
  tagString: 0x4487,
  chapters: 0x1043a770,
  edition: 0x45b9,
  atom: 0xb6,
  chapterStart: 0x91,
  display: 0x80,
  chapterString: 0x85,
  attachments: 0x1941a469,
  file: 0x61a7,
  fileName: 0x466e,
  fileType: 0x4660,
  fileData: 0x465c,
  cluster: 0x1f43b675,
};

/** An EBML variable-length integer at `at`: its value and length; the ID form keeps the marker. */
function vint(/** @type {Uint8Array} */ b, /** @type {number} */ at, keepMarker = false) {
  const first = b[at] ?? 0;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || at + length > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let unknown = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const byte = b[at + i] ?? 0;
    if (byte !== 0xff) unknown = false;
    value = value * 256 + byte;
  }
  return { value, length, unknown: !keepMarker && unknown };
}

/** The element whose header is at `at` in `bytes`; an unknown size runs to `room`. */
function elementAt(
  /** @type {Uint8Array} */ bytes,
  /** @type {number} */ at,
  /** @type {number} */ room,
) {
  const id = vint(bytes, at, true);
  if (!id || id.length > 4) return null;
  const size = vint(bytes, at + id.length);
  if (!size) return null;
  const start = at + id.length + size.length;
  const length = size.unknown ? room - (start - at) : size.value;
  return { id: id.value, at: start, size: length, end: start + length };
}

/** The elements inside bytes already read. */
function elements(/** @type {Uint8Array} */ bytes, start = 0, end = bytes.length) {
  /** @type {Element[]} */
  const out = [];
  for (let at = start; at < end && out.length < 4096; ) {
    const e = elementAt(bytes, at, end - at);
    if (!e || e.end > end + 0) {
      if (e) out.push({ ...e, end, size: end - e.at });
      break;
    }
    out.push(e);
    at = e.end;
  }
  return out;
}

const uint = (/** @type {Uint8Array} */ b, /** @type {Element} */ e) => {
  let value = 0;
  for (let i = e.at; i < e.end; i++) value = value * 256 + (b[i] ?? 0);
  return value;
};
const float = (/** @type {Uint8Array} */ b, /** @type {Element} */ e) => {
  const c = new Cursor(b, e.at);
  return e.size === 4 ? c.f32() : e.size === 8 ? c.f64() : 0;
};
const text = (/** @type {Uint8Array} */ b, /** @type {Element} */ e) =>
  utf8(b.subarray(e.at, e.end)).replace(/\0+$/, "");
const child = (/** @type {Uint8Array} */ b, /** @type {Element} */ e, /** @type {number} */ id) =>
  elements(b, e.at, e.end).find((c) => c.id === id);

const KINDS = /** @type {Record<number, Track["kind"]>} */ ({
  1: "video",
  2: "audio",
  17: "subtitle",
});

/** One TrackEntry as a track. */
function trackOf(/** @type {Uint8Array} */ b, /** @type {Element} */ entry) {
  const parts = elements(b, entry.at, entry.end);
  const get = (/** @type {number} */ id) => parts.find((p) => p.id === id);
  const type = get(ID.type);
  const kind = (type && KINDS[uint(b, type)]) ?? "other";
  const id = get(ID.codec) ? text(b, /** @type {Element} */ (get(ID.codec))) : "";
  const priv = get(ID.privateData);
  let codec = matroskaCodec(id);
  if (id === "V_MS/VFW/FOURCC" && priv)
    codec = fourccCodec(latin1(b.subarray(priv.at + 16, priv.at + 20)));
  if (id === "A_MS/ACM" && priv) codec = waveCodec(new Cursor(b, priv.at, true).u16());
  /** @type {Track} */
  const track = { kind, codec, codecId: id };
  const bcp47 = get(ID.bcp47);
  const legacy = get(ID.language);
  const language = bcp47 ? text(b, bcp47) : legacy ? text(b, legacy) : "eng";
  if (language && language !== "und") track.language = language;
  const name = get(ID.name);
  if (name) track.name = text(b, name);
  const encodings = get(ID.encodings);
  const encrypted = encodings
    ? elements(b, encodings.at, encodings.end).some(
        (e) => e.id === ID.encoding && child(b, e, ID.encryption) !== undefined,
      )
    : false;
  if (encrypted) /** @type {Track & { encrypted?: boolean }} */ (track).encrypted = true;
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
    track.sampleRate = rate ? float(b, rate) : 8000;
    track.channels = channels ? uint(b, channels) : 1;
    if (depth && codec === "PCM") track.bits = uint(b, depth);
  }
  return track;
}

/** The file's own tags: those that target no single track. */
function tagsOf(/** @type {Uint8Array} */ b, /** @type {Element} */ tags) {
  /** @type {Tags} */
  const out = {};
  const names = /** @type {Record<string, keyof Tags>} */ ({
    TITLE: "title",
    ARTIST: "artist",
    ALBUM: "album",
    ALBUM_ARTIST: "albumArtist",
    DATE_RELEASED: "year",
    DATE_RECORDED: "year",
    DATE: "year",
    GENRE: "genre",
    COMMENT: "comment",
    PART_NUMBER: "track",
  });
  for (const tag of elements(b, tags.at, tags.end).filter((e) => e.id === ID.tag)) {
    const parts = elements(b, tag.at, tag.end);
    const targets = parts.find((p) => p.id === ID.targets);
    if (targets && child(b, targets, ID.trackUid)) continue;
    for (const simple of parts.filter((p) => p.id === ID.simple)) {
      const name = child(b, simple, ID.tagName);
      const value = child(b, simple, ID.tagString);
      const key = name && names[text(b, name).toUpperCase()];
      if (key && value && !out[key])
        out[key] = key === "year" ? text(b, value).slice(0, 4) : text(b, value);
    }
  }
  return out;
}

/** The first edition's chapters. */
function chaptersOf(/** @type {Uint8Array} */ b, /** @type {Element} */ chapters) {
  const edition = child(b, chapters, ID.edition);
  if (!edition) return [];
  return elements(b, edition.at, edition.end)
    .filter((e) => e.id === ID.atom)
    .map((atom, i) => {
      const start = child(b, atom, ID.chapterStart);
      const display = child(b, atom, ID.display);
      const title = display && child(b, display, ID.chapterString);
      return {
        title: title ? text(b, title) : `Chapter ${i + 1}`,
        start: start ? uint(b, start) / 1e9 : 0,
      };
    });
}

/** A cover among the attachments: an image named cover, or the first image. */
function coverOf(/** @type {Uint8Array} */ b, /** @type {Element} */ attachments) {
  const files = elements(b, attachments.at, attachments.end)
    .filter((e) => e.id === ID.file)
    .map((file) => {
      const name = child(b, file, ID.fileName);
      const type = child(b, file, ID.fileType);
      const data = child(b, file, ID.fileData);
      return { name: name ? text(b, name) : "", type: type ? text(b, type) : "", data };
    })
    .filter((f) => f.type.startsWith("image/") && f.data);
  const pick = files.find((f) => /^cover/i.test(f.name)) ?? files[0];
  if (!pick?.data) return undefined;
  const bytes = b.slice(pick.data.at, pick.data.end);
  return { type: imageType(bytes, pick.type), bytes };
}

/** @type {Read} */
export async function readMatroska(source, head) {
  const ebml = elementAt(head, 0, head.length);
  if (!ebml || ebml.id !== ID.ebml) throw new Error("The EBML header is damaged.");
  const doc = child(head, ebml, ID.docType);
  const webm = doc ? text(head, doc) === "webm" : false;
  const segmentHeader = await source.read(ebml.end, 16);
  const segment = elementAt(segmentHeader, 0, source.size - ebml.end);
  if (!segment || segment.id !== ID.segment) throw new Error("This Matroska file has no segment.");
  const base = ebml.end + segment.at;
  const end = Math.min(source.size, ebml.end + segment.end);
  /** @type {Map<number, Uint8Array>} */
  const read = new Map();
  /** @type {Map<number, number>} */
  const seeks = new Map();
  const wanted = [ID.info, ID.tracks, ID.tags, ID.chapters, ID.attachments];
  const load = async (/** @type {number} */ at) => {
    const h = await source.read(at, 16);
    const e = elementAt(h, 0, end - at);
    if (!e) return null;
    const limit = e.id === ID.attachments ? 1 << 24 : 1 << 22;
    if (wanted.includes(e.id) && !read.has(e.id) && e.size <= limit)
      read.set(e.id, await source.read(at + e.at, e.size));
    if (e.id === ID.seekHead) {
      const bytes = await source.read(at + e.at, Math.min(e.size, 1 << 20));
      for (const seek of elements(bytes).filter((s) => s.id === ID.seek)) {
        const id = child(bytes, seek, ID.seekId);
        const position = child(bytes, seek, ID.seekPosition);
        if (id && position) seeks.set(uint(bytes, id), base + uint(bytes, position));
      }
    }
    return e;
  };
  for (let at = base, n = 0; at < end && n < 256; n++) {
    const e = await load(at);
    if (!e || e.id === ID.cluster) break;
    at += e.end;
  }
  for (const [id, at] of seeks)
    if (wanted.includes(id) && !read.has(id) && at < end) await load(at);
  const info = read.get(ID.info);
  let duration;
  /** @type {Tags} */
  let tags = {};
  if (info) {
    const parts = elements(info);
    const scale = parts.find((p) => p.id === ID.scale);
    const length = parts.find((p) => p.id === ID.duration);
    const title = parts.find((p) => p.id === ID.title);
    if (length) duration = (float(info, length) * (scale ? uint(info, scale) : 1e6)) / 1e9;
    if (title) tags.title = text(info, title);
  }
  const tracksBytes = read.get(ID.tracks);
  const tracks = tracksBytes
    ? elements(tracksBytes)
        .filter((e) => e.id === ID.entry)
        .map((e) => trackOf(tracksBytes, e))
    : [];
  const tagBytes = read.get(ID.tags);
  if (tagBytes)
    tags = {
      ...tagsOf(tagBytes, { id: ID.tags, at: 0, size: tagBytes.length, end: tagBytes.length }),
      ...tags,
    };
  const chapterBytes = read.get(ID.chapters);
  const chapters = chapterBytes
    ? chaptersOf(chapterBytes, {
        id: 0,
        at: 0,
        size: chapterBytes.length,
        end: chapterBytes.length,
      })
    : undefined;
  const attachmentBytes = read.get(ID.attachments);
  const cover = attachmentBytes
    ? coverOf(attachmentBytes, {
        id: 0,
        at: 0,
        size: attachmentBytes.length,
        end: attachmentBytes.length,
      })
    : undefined;
  const drm = tracks.some((t) => /** @type {{ encrypted?: boolean }} */ (t).encrypted)
    ? "Matroska encryption"
    : undefined;
  for (const t of tracks) delete (/** @type {{ encrypted?: boolean }} */ (t).encrypted);
  return { container: webm ? "WebM" : "Matroska", duration, tracks, tags, chapters, cover, drm };
}
