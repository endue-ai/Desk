// MP4, QuickTime, 3GP and M4A/M4B: the duration from mvhd, per track its kind (hdlr), language
// (mdhd), dimensions (tkhd) and codec (stsd and its configuration boxes), the iTunes tags in ilst
// with the cover, and Nero chapters (chpl). Only these boxes are read; the sample tables are skipped.
import { Cursor, imageType, latin1, utf8, utf16 } from "../bytes.js";
import { mp4Codec } from "../codecs.js";
import {
  av1Codec,
  avcCodec,
  boxes,
  boxesIn,
  contentOf,
  esdsCodec,
  hevcCodec,
  vp9Codec,
} from "./boxes.js";
import { GENRES } from "./id3.js";

/**
 * @typedef {import("../source.js").Source} Source
 * @typedef {import("./index.js").Track} Track
 * @typedef {import("./index.js").Tags} Tags
 * @typedef {import("./index.js").Read} Read
 * @typedef {import("./boxes.js").Box} Box
 */

const KINDS = {
  vide: "video",
  soun: "audio",
  subt: "subtitle",
  sbtl: "subtitle",
  text: "subtitle",
  clcp: "subtitle",
};

/** The child boxes of `box`, by type (the first of each). */
const childrenOf = async (/** @type {Source} */ source, /** @type {Box} */ box, skip = 0) => {
  const list = await boxes(source, box.at + box.header + skip, box.end);
  return { list, get: (/** @type {string} */ type) => list.find((b) => b.type === type) };
};

/** An mdhd's timescale, duration and ISO 639-2 language. */
function mediaHeader(/** @type {Uint8Array} */ mdhd) {
  const c = new Cursor(mdhd);
  const version = c.u8();
  c.skip(3 + (version === 1 ? 16 : 8));
  const scale = c.u32();
  const duration = version === 1 ? c.u64() : c.u32();
  const packed = c.u16();
  const lang = String.fromCharCode(
    ((packed >> 10) & 31) + 0x60,
    ((packed >> 5) & 31) + 0x60,
    (packed & 31) + 0x60,
  );
  return { scale, duration, language: /^[a-z]{3}$/.test(lang) && lang !== "und" ? lang : "" };
}

/** A tkhd's display width and height (16.16 fixed point). */
function trackSize(/** @type {Uint8Array} */ tkhd) {
  const c = new Cursor(tkhd, tkhd[0] === 1 ? 88 : 76);
  return { width: Math.round(c.u32() / 65536), height: Math.round(c.u32() / 65536) };
}

/** The first sample entry of an stsd: its codec, and what the entry itself says. */
function sampleEntry(/** @type {Uint8Array} */ stsd, /** @type {string} */ kind) {
  const entry = boxesIn(stsd, 8)[0];
  if (!entry) return null;
  const type = entry.type;
  const c = new Cursor(stsd, entry.at + 8);
  /** @type {Partial<Track> & { codec: string }} */
  const track = { codec: mp4Codec(type) };
  let children = entry.at + 8;
  if (kind === "video") {
    c.skip(24);
    track.width = c.u16();
    track.height = c.u16();
    children += 78;
  } else if (kind === "audio") {
    c.skip(8);
    const version = c.u16();
    c.skip(6);
    track.channels = c.u16();
    track.bits = c.u16();
    c.skip(4);
    track.sampleRate = c.u32() / 65536;
    children += 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
    if (version === 2) {
      const v2 = new Cursor(stsd, entry.at + 8 + 28);
      v2.skip(4);
      track.sampleRate = v2.f64();
      track.channels = v2.u32();
    }
  } else return { type, ...track };
  const config = (/** @type {Box[]} */ list, /** @type {string} */ name) => {
    const box = list.find((b) => b.type === name);
    return box ? stsd.subarray(box.at + box.header, box.end) : null;
  };
  let inner = boxesIn(stsd, children, entry.end);
  // QuickTime sound entries keep their esds inside a wave box.
  const wave = inner.find((b) => b.type === "wave");
  if (wave) inner = [...inner, ...boxesIn(stsd, wave.at + wave.header, wave.end)];
  // A protected entry (ISO/IEC 23001-7, FairPlay) names the codec in sinf's frma.
  const drm = protection(stsd, type, inner);
  if (drm) {
    track.codec = mp4Codec(drm.original) || track.codec;
    /** @type {Partial<Track> & { drm?: string }} */ (track).drm = drm.scheme;
  }
  const avcC = config(inner, "avcC");
  const hvcC = config(inner, "hvcC");
  const vpcC = config(inner, "vpcC");
  const av1C = config(inner, "av1C");
  const esds = config(inner, "esds");
  const named = drm?.original || type;
  if (avcC) track.codecId = avcCodec(named, avcC);
  else if (hvcC) track.codecId = hevcCodec(named, hvcC);
  else if (vpcC) track.codecId = vp9Codec(vpcC);
  else if (av1C) track.codecId = av1Codec(av1C);
  else if (esds) Object.assign(track, esdsCodec(esds) ?? {});
  else {
    const ids = {
      Opus: "opus",
      fLaC: "flac",
      "ac-3": "ac-3",
      "ec-3": "ec-3",
      alac: "alac",
      ".mp3": "mp3",
    };
    const id = /** @type {Record<string, string>} */ (ids)[type];
    if (id) track.codecId = id;
  }
  return { type, ...track };
}

/** Whether a sample entry is protected: by which scheme, and the format it stands for. */
function protection(
  /** @type {Uint8Array} */ stsd,
  /** @type {string} */ type,
  /** @type {Box[]} */ inner,
) {
  if (!["encv", "enca", "encs", "enct", "drms", "drmi"].includes(type)) return null;
  const sinf = inner.find((b) => b.type === "sinf");
  const parts = sinf ? boxesIn(stsd, sinf.at + sinf.header, sinf.end) : [];
  const frma = parts.find((b) => b.type === "frma");
  const schm = parts.find((b) => b.type === "schm");
  const at = (/** @type {Box | undefined} */ b, skip = 0) =>
    b ? latin1(stsd.subarray(b.at + b.header + skip, b.at + b.header + skip + 4)) : "";
  // Without frma, the configuration box says what the entry stands for.
  const configs = /** @type {Record<string, string>} */ ({
    avcC: "avc1",
    hvcC: "hvc1",
    esds: "mp4a",
  });
  const original = at(frma) || (inner.map((b) => configs[b.type]).find(Boolean) ?? "");
  // schm is a full box: its scheme type follows the version and flags.
  const scheme = at(schm, 4);
  const fairplay = type.startsWith("drm") || scheme === "itun";
  return { original, scheme: fairplay ? "FairPlay" : "Common Encryption" };
}

/** iTunes-style tags and the cover from an ilst box's content. */
function itunesTags(/** @type {Uint8Array} */ ilst) {
  /** @type {Tags} */
  const tags = {};
  /** @type {{ type: string, bytes: Uint8Array } | undefined} */
  let cover;
  for (const item of boxesIn(ilst)) {
    const data = boxesIn(ilst, item.at + item.header, item.end).find((b) => b.type === "data");
    if (!data) continue;
    const c = new Cursor(ilst, data.at + data.header);
    const kind = c.u32() & 0xffffff;
    const value = ilst.subarray(data.at + data.header + 8, data.end);
    const text = kind === 2 ? utf16(value, false) : utf8(value);
    const name = item.type;
    if (name === "\xa9nam") tags.title = text;
    else if (name === "\xa9ART") tags.artist = text;
    else if (name === "aART") tags.albumArtist = text;
    else if (name === "\xa9alb") tags.album = text;
    else if (name === "\xa9day") tags.year = text.slice(0, 4);
    else if (name === "\xa9gen") tags.genre = text;
    else if (name === "\xa9cmt") tags.comment = text;
    else if (name === "gnre" && value.length >= 2)
      tags.genre = GENRES[((value[0] ?? 0) << 8) + (value[1] ?? 0) - 1];
    else if (name === "trkn" && value.length >= 4)
      tags.track = String(((value[2] ?? 0) << 8) | (value[3] ?? 0));
    else if (name === "covr" && !cover && value.length > 0)
      cover = { type: kind === 14 ? "image/png" : imageType(value), bytes: value.slice() };
  }
  return { tags, cover };
}

/** Nero chapters: start times in 100 ns, titles in UTF-8. */
function neroChapters(/** @type {Uint8Array} */ chpl) {
  const c = new Cursor(chpl);
  const version = c.u8();
  c.skip(3 + (version === 1 ? 4 : 0));
  const count = c.u8();
  const chapters = [];
  for (let i = 0; i < count && c.left > 9; i++) {
    const start = c.u64() / 1e7;
    const title = utf8(c.take(c.u8()));
    chapters.push({ title, start });
  }
  return chapters;
}

/** @type {Read} */
export async function readMp4(source) {
  const top = await boxes(source, 0, source.size);
  const ftyp = top.find((b) => b.type === "ftyp");
  const brand = ftyp ? latin1(await source.read(ftyp.at + 8, 4)) : "qt  ";
  const quicktime = brand === "qt  ";
  const container = quicktime ? "QuickTime" : brand.startsWith("3g") ? "3GP" : "MP4";
  const moov = top.find((b) => b.type === "moov");
  if (!moov) throw new Error(`This ${container} file has no movie header (moov).`);
  const movie = await childrenOf(source, moov);
  const mvhd = movie.get("mvhd");
  let duration;
  if (mvhd) {
    const m = new Cursor(await contentOf(source, mvhd, 64));
    const version = m.u8();
    m.skip(3 + (version === 1 ? 16 : 8));
    const scale = m.u32();
    const length = version === 1 ? m.u64() : m.u32();
    if (scale > 0 && length > 0 && length < 2 ** 52) duration = length / scale;
  }
  /** @type {Track[]} */
  const tracks = [];
  /** @type {string | undefined} */
  let drm;
  let longest = 0;
  for (const trak of movie.list.filter((b) => b.type === "trak")) {
    const t = await childrenOf(source, trak);
    const mdiaBox = t.get("mdia");
    if (!mdiaBox) continue;
    const mdia = await childrenOf(source, mdiaBox);
    const hdlr = mdia.get("hdlr");
    const handler = hdlr ? latin1((await contentOf(source, hdlr, 12)).subarray(8, 12)) : "";
    const kind = /** @type {Record<string, Track["kind"]>} */ (KINDS)[handler] ?? "other";
    const mdhdBox = mdia.get("mdhd");
    const header = mdhdBox ? mediaHeader(await contentOf(source, mdhdBox, 64)) : null;
    if (header && header.scale > 0) longest = Math.max(longest, header.duration / header.scale);
    const minf = mdia.get("minf");
    const stbl = minf ? (await childrenOf(source, minf)).get("stbl") : undefined;
    const stsd = stbl ? (await childrenOf(source, stbl)).get("stsd") : undefined;
    const entry = stsd ? sampleEntry(await contentOf(source, stsd, 1 << 20), kind) : null;
    if (kind === "other" && !entry) continue;
    /** @type {Track} */
    const track = { kind, codec: entry?.codec ?? handler };
    if (entry?.codecId) track.codecId = entry.codecId;
    if (entry?.drm) drm = entry.drm;
    if (kind === "video") {
      const tkhd = t.get("tkhd");
      const shown = tkhd ? trackSize(await contentOf(source, tkhd, 96)) : { width: 0, height: 0 };
      track.width = shown.width || entry?.width;
      track.height = shown.height || entry?.height;
    }
    if (kind === "audio") {
      track.channels = entry?.channels;
      track.sampleRate = entry?.sampleRate || header?.scale;
      if (entry?.bits && track.codec === "PCM") track.bits = entry.bits;
    }
    if (header?.language) track.language = header.language;
    tracks.push(track);
  }
  if (!duration && longest > 0) duration = longest;
  /** @type {Tags} */
  let tags = {};
  /** @type {{ type: string, bytes: Uint8Array } | undefined} */
  let cover;
  /** @type {{ title: string, start: number }[] | undefined} */
  let chapters;
  const udta = movie.get("udta");
  const meta =
    movie.get("meta") ?? (udta ? (await childrenOf(source, udta)).get("meta") : undefined);
  if (meta) {
    const peek = latin1(await source.read(meta.at + meta.header + 4, 4));
    const ilst = (await childrenOf(source, meta, peek === "hdlr" ? 0 : 4)).get("ilst");
    if (ilst) ({ tags, cover } = itunesTags(await contentOf(source, ilst)));
  }
  const chpl = udta ? (await childrenOf(source, udta)).get("chpl") : undefined;
  if (chpl) chapters = neroChapters(await contentOf(source, chpl, 1 << 20));
  const video = tracks.some((t) => t.kind === "video");
  const mime = quicktime ? "video/quicktime" : video ? "video/mp4" : "audio/mp4";
  return { container, mime, duration, tracks, tags, cover, chapters, drm };
}
