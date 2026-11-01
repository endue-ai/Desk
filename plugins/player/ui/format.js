// Which format a file is: from its first bytes, then from its extension. The family says what the
// player does with it: play media through the webview, read subtitles or a playlist, or play MIDI and
// AU itself.
import { startsWith } from "./bytes.js";

export const VIDEO_EXTENSIONS =
  "mp4 m4v mov qt mkv webm avi wmv asf flv f4v mpg mpeg m2ts mts vob 3gp 3g2 ogv rm rmvb mxf".split(
    " ",
  );
export const AUDIO_EXTENSIONS =
  "mp3 aac m4a m4b wav aif aiff aifc flac ogg oga opus weba caf wma ape wv mka amr dsf dff".split(
    " ",
  );
export const SUBTITLE_EXTENSIONS = "srt vtt ass ssa sbv ttml dfxp smi sami".split(" ");
export const PLAYLIST_EXTENSIONS = "m3u m3u8 pls xspf cue".split(" ");

/**
 * @typedef {"media" | "subtitles" | "playlist" | "midi" | "au" | ""} Family
 * @typedef {{ format: string, family: Family }} Detected
 */

/** The extension in lower case, without the dot. */
export const extensionOf = (/** @type {string} */ name) =>
  /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";

/** @returns {Family} */
export function familyByName(/** @type {string} */ name) {
  const ext = extensionOf(name);
  if (ext === "mid" || ext === "midi") return "midi";
  if (ext === "au" || ext === "snd") return "au";
  if (SUBTITLE_EXTENSIONS.includes(ext)) return "subtitles";
  if (PLAYLIST_EXTENSIONS.includes(ext)) return "playlist";
  if (VIDEO_EXTENSIONS.includes(ext) || AUDIO_EXTENSIONS.includes(ext)) return "media";
  return "";
}

/** Whether the name says video rather than audio, for a file whose bytes said nothing. */
export const videoByName = (/** @type {string} */ name) =>
  VIDEO_EXTENSIONS.includes(extensionOf(name));

const ASF = [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11];
const MXF = [0x06, 0x0e, 0x2b, 0x34, 0x02, 0x05, 0x01, 0x01];

const matches = (/** @type {Uint8Array} */ head, /** @type {number[]} */ bytes) =>
  bytes.every((b, i) => head[i] === b);

/** MPEG audio after an ID3v2 tag or at the start: ADTS AAC, or a Layer I to III frame. */
function mpegAudio(/** @type {Uint8Array} */ head, /** @type {number} */ at) {
  if (head[at] !== 0xff) return "";
  const b = head[at + 1] ?? 0;
  if ((b & 0xf6) === 0xf0) return "aac";
  if ((b & 0xe0) === 0xe0 && (b & 0x06) !== 0) return "mp3";
  return "";
}

/** The container a file's first bytes name, or "" when they name none. */
function magic(/** @type {Uint8Array} */ head) {
  const at4 = (/** @type {string} */ text) => startsWith(head, text, 4);
  if (["ftyp", "moov", "mdat", "free", "wide", "skip", "pnot"].some(at4)) return "mp4";
  if (matches(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    const doc = String.fromCharCode(...head.subarray(0, 64));
    return doc.includes("webm") ? "webm" : "matroska";
  }
  if (startsWith(head, "RIFF") || startsWith(head, "RF64") || startsWith(head, "BW64")) {
    if (startsWith(head, "AVI ", 8)) return "avi";
    if (startsWith(head, "WAVE", 8)) return "wav";
    if (startsWith(head, "RMID", 8)) return "midi";
  }
  if (matches(head, ASF)) return "asf";
  if (startsWith(head, "FLV") && head[3] === 1) return "flv";
  if (head[0] === 0x47 && head[188] === 0x47 && (head.length < 377 || head[376] === 0x47))
    return "mpegts";
  if (head[4] === 0x47 && head[196] === 0x47) return "mpegts";
  if (matches(head, [0, 0, 1, 0xba]) || matches(head, [0, 0, 1, 0xb3])) return "mpegps";
  if (startsWith(head, "OggS")) return "ogg";
  if (startsWith(head, "fLaC")) return "flac";
  if (startsWith(head, "ID3")) {
    const size =
      10 +
      (((head[6] ?? 0) << 21) | ((head[7] ?? 0) << 14) | ((head[8] ?? 0) << 7) | (head[9] ?? 0));
    let at = size;
    while (at < head.length && head[at] === 0) at++;
    if (startsWith(head, "fLaC", at)) return "flac";
    return mpegAudio(head, at) || "mp3";
  }
  if (startsWith(head, "FORM") && (startsWith(head, "AIFF", 8) || startsWith(head, "AIFC", 8)))
    return "aiff";
  if (startsWith(head, "caff")) return "caf";
  if (startsWith(head, "MAC ")) return "ape";
  if (startsWith(head, "wvpk")) return "wavpack";
  if (startsWith(head, "DSD ")) return "dsf";
  if (startsWith(head, "FRM8")) return "dff";
  if (startsWith(head, "#!AMR")) return "amr";
  if (startsWith(head, ".RMF")) return "realmedia";
  if (matches(head, MXF)) return "mxf";
  if (startsWith(head, ".snd")) return "au";
  if (startsWith(head, "MThd")) return "midi";
  return mpegAudio(head, 0);
}

/** Subtitles and playlists say what they are in their first lines. */
function textual(/** @type {Uint8Array} */ head) {
  let text;
  try {
    const little = head[0] === 0xff && head[1] === 0xfe;
    const big = head[0] === 0xfe && head[1] === 0xff;
    const label = little ? "utf-16le" : big ? "utf-16be" : "utf-8";
    text = new TextDecoder(label).decode(head.subarray(0, 4096)).replace(/^\uFEFF/, "");
  } catch {
    return "";
  }
  const start = text.trimStart();
  if (/^WEBVTT/.test(start) || /^\[Script Info\]/i.test(start)) return "subtitles";
  if (/<sami[\s>]/i.test(text) || /<tt[\s>][\s\S]*ttml|ttaf1/i.test(text)) return "subtitles";
  if (/^\d+\s*\r?\n\d+:\d\d:\d\d[,.]\d+\s*-->/.test(start)) return "subtitles";
  if (/^#EXTM3U/i.test(start) || /^\[playlist\]/i.test(start)) return "playlist";
  if (/<playlist[\s>][\s\S]*xspf/i.test(text)) return "playlist";
  return "";
}

/** @returns {Family} */
function familyOf(/** @type {string} */ format) {
  if (format === "midi") return "midi";
  if (format === "au") return "au";
  return "media";
}

/**
 * @param {Uint8Array} head the file's first bytes (64 KiB is plenty)
 * @param {string} name the file name, for the extension
 * @returns {Detected}
 */
export function detect(head, name) {
  const format = magic(head);
  if (format) return { format, family: familyOf(format) };
  const byName = familyByName(name);
  // A media extension on unknown bytes still goes to the webview: it may know more than we do.
  if (byName === "media" || byName === "midi" || byName === "au")
    return { format: "", family: byName };
  const text = textual(head);
  if (text) return { format: "", family: text };
  return { format: "", family: byName };
}
