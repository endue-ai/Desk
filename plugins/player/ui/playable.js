// Whether the webview can play what the readers found, by asking it with canPlayType: the container's
// media type first, then each track's codec where the container has a standard codec string. What it
// refuses gets the one sentence the details view shows.
import { words } from "./codecs.js";

/**
 * @typedef {import("./probe/index.js").Info} Info
 * @typedef {import("./probe/index.js").Track} Track
 * @typedef {(type: string) => string} CanPlay
 */

const MP4_STRINGS = /^(avc[13]|hvc1|hev1|vp09|av01|mp4a|opus$|flac$|ac-3$|ec-3$|alac$|mp3$)/;
const WEBM_STRINGS = /** @type {Record<string, string>} */ ({
  VP8: "vp8",
  VP9: "vp9",
  Opus: "opus",
  Vorbis: "vorbis",
});
const OGG_STRINGS = /** @type {Record<string, string>} */ ({
  Vorbis: "vorbis",
  Opus: "opus",
  FLAC: "flac",
  Theora: "theora",
});

/** The codec string canPlayType understands for a track in this container, or "". */
function codecString(/** @type {Info} */ info, /** @type {Track} */ track) {
  if (info.format === "mp4")
    return track.codecId && MP4_STRINGS.test(track.codecId) ? track.codecId : "";
  if (info.format === "webm") return WEBM_STRINGS[track.codec] ?? "";
  if (info.format === "ogg") return OGG_STRINGS[track.codec] ?? "";
  return "";
}

const media = (/** @type {Track[]} */ tracks) =>
  tracks.filter((t) => t.kind === "video" || t.kind === "audio");

/** "This system's WebKit cannot play MP4 with H.264 and AAC." */
export function cannot(/** @type {Info} */ info, tracks = info.tracks) {
  const all = [...new Set(media(tracks).map((t) => t.codec))];
  if (all.length === 0)
    return `This system's WebKit cannot play ${info.container} with an unknown codec.`;
  // "cannot play WavPack with WavPack" says the name twice: the container's own codec is left out.
  const names = all.filter((name) => name !== info.container);
  if (names.length === 0) return `This system's WebKit cannot play ${info.container}.`;
  return `This system's WebKit cannot play ${info.container} with ${words(names)}.`;
}

/**
 * The sentence for what the webview says it cannot play, or null when it may play it.
 * @param {Info} info
 * @param {CanPlay} canPlay
 */
export function refusal(info, canPlay) {
  if (canPlay(info.mime) === "") return cannot(info);
  for (const track of media(info.tracks)) {
    const codec = codecString(info, track);
    if (codec && canPlay(`${info.mime}; codecs="${codec}"`) === "") return cannot(info, [track]);
  }
  return null;
}
