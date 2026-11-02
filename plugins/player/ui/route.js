// Which engine plays a file the readers know: the webview's own media element ("native"), the
// plugin's demuxers remuxing it to fragmented MP4 for Media Source Extensions ("remux", ui/remux/),
// or FFmpeg's decoders in WebAssembly ("software", ui/software/). The engines are tried in order: one
// that fails at run time hands the file to the next, and the details view says why when none is left.
// Encrypted and DRM files go straight to the details view.
import { cannot, refusal } from "./playable.js";
import { REMUX_CODECS, REMUX_FORMATS } from "./remux/index.js";

/**
 * @typedef {import("./probe/index.js").Info} Info
 * @typedef {import("./probe/index.js").Track} Track
 * @typedef {"native" | "remux" | "software"} Engine
 * @typedef {{ canPlay(type: string): string, canRemux(type: string): boolean, software: boolean }} Caps
 *   canPlay: the media element's canPlayType; canRemux: MediaSource.isTypeSupported (false without
 *   MSE); software: whether workers and WebAssembly can run the decoder here.
 * @typedef {{ engines: Engine[], why: string }} Route
 */

/** A codec string for each codec the remuxer carries, to ask MSE whether it decodes it at all. */
const MSE_TYPES = /** @type {Record<string, string>} */ ({
  "H.264": 'video/mp4; codecs="avc1.42E01E"',
  HEVC: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  VP9: 'video/mp4; codecs="vp09.00.10.08"',
  AV1: 'video/mp4; codecs="av01.0.04M.08"',
  AAC: 'audio/mp4; codecs="mp4a.40.2"',
  MP3: 'audio/mp4; codecs="mp4a.6B"',
  Opus: 'audio/mp4; codecs="Opus"',
  FLAC: 'audio/mp4; codecs="fLaC"',
  "Apple Lossless": 'audio/mp4; codecs="alac"',
  "AC-3": 'audio/mp4; codecs="ac-3"',
  "E-AC-3": 'audio/mp4; codecs="ec-3"',
  PCM: 'audio/mp4; codecs="ipcm"',
});

/** What the vendored FFmpeg build decodes (scripts/vendor-ffmpeg.sh), by the readers' codec names. */
export const SOFTWARE_CODECS = {
  video: [
    "Windows Media Video 7",
    "Windows Media Video 8",
    "Windows Media Video 9",
    "Windows Media Video 9 Advanced",
    "VC-1",
    "MPEG-4 Part 2",
    "MPEG-4 Part 2 (Microsoft)",
    "H.263",
    "Sorenson Spark",
    "VP6",
    "VP8",
    "Theora",
    "RealVideo 1.0",
    "RealVideo 2.0",
    "RealVideo 3.0",
    "RealVideo 4.0",
    "MPEG-1 Video",
    "MPEG-2 Video",
    "Motion JPEG",
    "DV",
  ],
  audio: [
    "Windows Media Audio 1",
    "Windows Media Audio 2",
    "Windows Media Audio Pro",
    "Windows Media Audio Lossless",
    "Windows Media Voice",
    "Monkey's Audio",
    "WavPack",
    "AMR-NB",
    "AMR-WB",
    "DSD",
    "Vorbis",
    "Cook",
    "RealAudio 1.0",
    "RealAudio 2.0",
    "Sipro",
    "ATRAC3",
    "AAC",
    "AC-3",
    "E-AC-3",
    "DTS",
    "Dolby TrueHD",
    "MP3",
    "MP2",
    "MPEG audio",
    "FLAC",
    "Apple Lossless",
    "Speex",
    "PCM",
    "LPCM",
    "A-law",
    "μ-law",
    "MS ADPCM",
    "IMA ADPCM",
    "GSM 6.10",
  ],
};

/**
 * Containers the media stacks behind WebKit (AVFoundation, Media Foundation) do not read, though
 * canPlayType may answer "maybe" for some (it does for AVI on macOS). The plugin's own engines go
 * first for them, and the element last; GStreamer (WebKitGTK) answers "probably" when it can.
 */
const FOREIGN = new Set([
  "matroska",
  "avi",
  "flv",
  "asf",
  "realmedia",
  "mxf",
  "mpegts",
  "mpegps",
  "ape",
  "wavpack",
  "dsf",
  "dff",
  "amr",
]);

const media = (/** @type {Track[]} */ tracks, /** @type {"video" | "audio"} */ kind) =>
  tracks.filter((t) => t.kind === kind);

/** Whether the remuxer can carry the file's picture (or, without one, its sound) to MSE. */
function remuxable(/** @type {Info} */ info, /** @type {Caps} */ caps) {
  if (!REMUX_FORMATS.includes(info.format)) return false;
  const msePlays = (/** @type {Track} */ t, /** @type {string[]} */ carried) =>
    carried.includes(t.codec) && caps.canRemux(MSE_TYPES[t.codec] ?? "");
  const video = media(info.tracks, "video");
  const audio = media(info.tracks, "audio");
  // MXF's reader names no tracks: the remuxer finds out when it opens the file.
  if (video.length === 0 && audio.length === 0) return caps.canRemux(MSE_TYPES["H.264"] ?? "");
  // The picture decides; a sound MSE refuses is decoded beside it in software, or left out.
  if (video.length > 0) return video.slice(0, 1).some((t) => msePlays(t, REMUX_CODECS.video));
  return audio.some((t) => msePlays(t, REMUX_CODECS.audio));
}

/** Whether the software decoder decodes the first picture and one of the sounds. */
function decodable(/** @type {Info} */ info, /** @type {Caps} */ caps) {
  if (!caps.software) return false;
  const video = media(info.tracks, "video");
  const audio = media(info.tracks, "audio");
  if (video.length === 0 && audio.length === 0) return true;
  const first = video[0];
  if (first && !SOFTWARE_CODECS.video.includes(first.codec)) return false;
  return audio.length === 0 || audio.some((t) => SOFTWARE_CODECS.audio.includes(t.codec));
}

/** "Windows Media with Windows Media Video 9 is protected with Windows Media DRM ..." */
export const protectedWhy = (/** @type {Info} */ info) =>
  `This ${info.container} file is protected with ${info.drm}: the player cannot play it.`;

/**
 * The engines to try for a probed file, in order, and the sentence the details view shows when none
 * plays it.
 * @param {Info} info
 * @param {Caps} caps
 * @returns {Route}
 */
export function route(info, caps) {
  if (info.drm) return { engines: [], why: protectedWhy(info) };
  /** @type {Engine[]} */
  const ours = [];
  if (remuxable(info, caps)) ours.push("remux");
  if (decodable(info, caps)) ours.push("software");
  const refused = refusal(info, caps.canPlay);
  const why = refused ?? cannot(info);
  if (refused !== null) return { engines: ours, why };
  const sure = caps.canPlay(info.mime) === "probably";
  if (FOREIGN.has(info.format) && !sure && ours.length > 0)
    return { engines: [...ours, "native"], why };
  return { engines: ["native", ...ours], why };
}

/**
 * A file the readers could not read: one whose bytes name no format the player reads goes to the
 * webview and the decoder, which may know more; a container they recognised but found damaged goes
 * only to the decoder, and to the details view with the reader's words when that fails too.
 * @param {string} format what the first bytes named ("" for nothing)
 * @param {string} problem the reader's sentence
 * @param {Caps} caps
 * @returns {Route}
 */
export function routeUnread(format, problem, caps) {
  /** @type {Engine[]} */
  const software = caps.software ? ["software"] : [];
  if (format) return { engines: software, why: problem };
  return { engines: ["native", ...software], why: problem };
}
