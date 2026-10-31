// The player's own readers for a media file's details and tags: which container it is, how long, its
// tracks with codecs, dimensions and languages, its tags and cover. Each reader takes a ranged source
// and reads only the headers it needs. No third-party code.
import { detect, videoByName } from "../format.js";
import { readAiff, readCaf } from "./aiff.js";
import { readAsf } from "./asf.js";
import { readDff, readDsf } from "./dsd.js";
import { readFlac } from "./flac.js";
import { readFlv } from "./flv.js";
import { readApe, readWavPack } from "./lossless.js";
import { readMatroska } from "./matroska.js";
import { readAmr, readMxf, readRealMedia } from "./misc.js";
import { readAac, readMp3 } from "./mp3.js";
import { readMp4 } from "./mp4.js";
import { readMpegPs, readMpegTs } from "./mpeg.js";
import { readOgg } from "./ogg.js";
import { readRiff } from "./riff.js";

/**
 * @typedef {{
 *   kind: "video" | "audio" | "subtitle" | "other",
 *   codec: string,
 *   codecId?: string,
 *   width?: number,
 *   height?: number,
 *   channels?: number,
 *   sampleRate?: number,
 *   bits?: number,
 *   language?: string,
 *   name?: string,
 * }} Track
 * @typedef {{ title?: string, artist?: string, album?: string, albumArtist?: string, year?: string,
 *   track?: string, genre?: string, comment?: string }} Tags
 * @typedef {{ type: string, bytes: Uint8Array }} Picture
 * @typedef {{ title: string, start: number }} Chapter
 * @typedef {{
 *   format: string,
 *   container: string,
 *   mime: string,
 *   video: boolean,
 *   duration?: number,
 *   tracks: Track[],
 *   tags: Tags,
 *   cover?: Picture,
 *   chapters?: Chapter[],
 * }} Info
 * @typedef {{ container?: string, mime?: string, duration?: number, tracks?: Track[], tags?: Tags,
 *   cover?: Picture, chapters?: Chapter[] }} Found
 * @typedef {(source: import("../source.js").Source, head: Uint8Array) => Promise<Found>} Read
 */

/** @type {Record<string, { name: string, video: string, audio: string, read: Read }>} */
const READERS = {
  mp4: { name: "MP4", video: "video/mp4", audio: "audio/mp4", read: readMp4 },
  matroska: {
    name: "Matroska",
    video: "video/x-matroska",
    audio: "audio/x-matroska",
    read: readMatroska,
  },
  webm: { name: "WebM", video: "video/webm", audio: "audio/webm", read: readMatroska },
  avi: { name: "AVI", video: "video/x-msvideo", audio: "video/x-msvideo", read: readRiff },
  wav: { name: "WAV", video: "audio/wav", audio: "audio/wav", read: readRiff },
  asf: { name: "Windows Media", video: "video/x-ms-wmv", audio: "audio/x-ms-wma", read: readAsf },
  flv: { name: "Flash Video", video: "video/x-flv", audio: "video/x-flv", read: readFlv },
  mpegts: {
    name: "MPEG transport stream",
    video: "video/mp2t",
    audio: "video/mp2t",
    read: readMpegTs,
  },
  mpegps: {
    name: "MPEG program stream",
    video: "video/mpeg",
    audio: "video/mpeg",
    read: readMpegPs,
  },
  ogg: { name: "Ogg", video: "video/ogg", audio: "audio/ogg", read: readOgg },
  flac: { name: "FLAC", video: "audio/flac", audio: "audio/flac", read: readFlac },
  mp3: { name: "MP3", video: "audio/mpeg", audio: "audio/mpeg", read: readMp3 },
  aac: { name: "AAC", video: "audio/aac", audio: "audio/aac", read: readAac },
  aiff: { name: "AIFF", video: "audio/aiff", audio: "audio/aiff", read: readAiff },
  caf: { name: "CAF", video: "audio/x-caf", audio: "audio/x-caf", read: readCaf },
  ape: { name: "Monkey's Audio", video: "audio/x-ape", audio: "audio/x-ape", read: readApe },
  wavpack: {
    name: "WavPack",
    video: "audio/x-wavpack",
    audio: "audio/x-wavpack",
    read: readWavPack,
  },
  dsf: { name: "DSF", video: "audio/x-dsf", audio: "audio/x-dsf", read: readDsf },
  dff: { name: "DSDIFF", video: "audio/x-dff", audio: "audio/x-dff", read: readDff },
  amr: { name: "AMR", video: "audio/amr", audio: "audio/amr", read: readAmr },
  realmedia: {
    name: "RealMedia",
    video: "application/vnd.rn-realmedia",
    audio: "audio/x-pn-realaudio",
    read: readRealMedia,
  },
  mxf: { name: "MXF", video: "application/mxf", audio: "application/mxf", read: readMxf },
};

/** The display name of a detected format, for a details view that has nothing more. */
export const containerName = (/** @type {string} */ format) => READERS[format]?.name ?? "";

const HEAD = 64 * 1024;

/**
 * Read a media file's details. A damaged file throws an Error whose message says why in words.
 * @param {import("../source.js").Source} source
 * @param {string} name the file name, for the extension when the bytes say nothing
 * @returns {Promise<Info>}
 */
export async function probe(source, name) {
  const head = await source.read(0, HEAD);
  const { format } = detect(head, name);
  const reader = READERS[format];
  if (!reader) throw new Error("Its first bytes match no audio or video format the player reads.");
  const found = await reader.read(source, head);
  const tracks = found.tracks ?? [];
  const video = tracks.length > 0 ? tracks.some((t) => t.kind === "video") : videoByName(name);
  const duration =
    found.duration !== undefined && Number.isFinite(found.duration) && found.duration > 0
      ? found.duration
      : undefined;
  /** @type {Info} */
  const info = {
    format,
    container: found.container ?? reader.name,
    mime: found.mime ?? (video ? reader.video : reader.audio),
    video,
    tracks,
    tags: clean(found.tags ?? {}),
  };
  if (duration !== undefined) info.duration = duration;
  if (found.cover) info.cover = found.cover;
  if (found.chapters?.length) info.chapters = found.chapters;
  return info;
}

/** Tags without empty values, trimmed. */
function clean(/** @type {Tags} */ tags) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(tags)) {
    const text = typeof value === "string" ? value.replace(/\0+$/, "").trim() : "";
    if (text) out[key] = text;
  }
  return /** @type {Tags} */ (out);
}
