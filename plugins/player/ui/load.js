// Opening one file by what it is: media through fs.url and the readers, MIDI and AU decoded by the
// player, subtitles shown as their cues, playlists played entry by entry, and the subtitles found
// next to a video. Each function fills in the open file's entry; player.js shows it.
import { CHUNK, FileError, folderOf, nameOf } from "./access.js";
import { decodeAu } from "./au.js";
import { toBase64 } from "./bytes.js";
import { detect, extensionOf, familyByName, videoByName } from "./format.js";
import { readMidi } from "./midi.js";
import { cannot } from "./playable.js";
import { parsePlaylist } from "./playlists.js";
import { containerName, probe } from "./probe/index.js";
import { route, routeUnread } from "./route.js";
import { parseSubtitles, sameName } from "./subtitles.js";
import { parseSami } from "./subtitles-xml.js";
import { render } from "./synth.js";
import { decodeText, looksLikeText } from "./text.js";

/**
 * @typedef {import("./player.js").Entry} Entry
 * @typedef {import("./player.js").Item} Item
 * @typedef {ReturnType<typeof import("./access.js").createAccess>} Access
 * @typedef {{ access: Access, caps: import("./route.js").Caps,
 *   options: import("./player.js").PlayerOptions, show(entry: Entry): void }} Deps
 */

export const HEAD = 64 * 1024;
/** How long the readers may take before the file plays anyway; their facts arrive after. */
const PROBE_BUDGET_MS = 1500;
const MAX_TEXT = 16 * CHUNK;
const MAX_MIDI = 8 * CHUNK;
const MAX_AU = 128 * CHUNK;

const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);
const wait = (/** @type {number} */ ms) =>
  new Promise((resolve) => setTimeout(() => resolve(null), ms));

/** A picture as a data: URL the view can show (img-src allows data:). */
export const pictureUrl = (
  /** @type {{ type: string, bytes: Uint8Array } | undefined} */ picture,
) => (picture ? `data:${picture.type};base64,${toBase64(picture.bytes)}` : undefined);

/** Show the entry as details: what the file is and one sentence why it is not played. */
export function details(
  /** @type {Entry} */ entry,
  /** @type {string} */ why,
  /** @type {string} */ format,
) {
  entry.mode = "details";
  entry.why = why;
  entry.format = format || entry.format || "Unknown";
}

/**
 * What the view says the system plays: canPlayType, MSE and the software decoder.
 * @param {import("./player.js").PlayerView} view
 * @returns {import("./route.js").Caps}
 */
export const capsOf = (view) => ({
  canPlay: (type) => view.canPlay(type),
  canRemux: (type) => view.canRemux?.(type) ?? false,
  get software() {
    return view.software ?? false;
  },
});

/** What the status line says about the item on screen when its playback goes wrong. */
export const SAYINGS = {
  /** Playing, and the position has not moved for seconds: the file can no longer be read. */
  stalled: (/** @type {string} */ name) =>
    `Playback stopped: ${name} can no longer be read. Its permission may have been taken back; choose Try again.`,
  /** The software decoder leaves frames out: said once per file. */
  dropping: (/** @type {string} */ name) =>
    `This computer cannot decode ${name} in real time: some frames are left out.`,
  /** The person stopped the opening or the buffering. */
  cancelled: (/** @type {string} */ name) => `Stopped ${name}. Choose Try again to play it.`,
};

/**
 * The engine playing the entry's item failed: the next engine of its route takes over, or the
 * details say why. The sentence when the details are shown, "" otherwise.
 * @param {Entry} entry
 * @param {string} [reason] the failing engine's words (the native element has none)
 */
export function fallBack(entry, reason) {
  const item = entry.item;
  if (!item || entry.mode !== "media") return "";
  const next = item.engines?.shift();
  if (next) {
    item.engine = next;
    return "";
  }
  const fallback = item.info
    ? (item.why ?? cannot(item.info))
    : item.problem || item.why || `This system's WebKit cannot play ${item.name}.`;
  const why = reason && item.engine !== "native" ? reason : fallback;
  delete item.url;
  details(entry, why, item.format);
  return why;
}

/** Play the item with the first of `engines`, or show the details when none is left. */
function plan(
  /** @type {Entry} */ entry,
  /** @type {Item} */ item,
  /** @type {import("./route.js").Route} */ route,
  /** @type {string} */ format,
) {
  const [first, ...rest] = route.engines;
  item.engines = rest;
  item.why = route.why;
  if (first) {
    item.engine = first;
    return;
  }
  delete item.url;
  details(entry, route.why, format);
}

/**
 * Play a media file through fs.url: the URL first (the visit's one ask), then the head and the
 * readers, then the route decides between the webview, the remuxer, the software decoder and the
 * details (route.js).
 * @param {Entry} entry
 * @param {string} path the file to play: the entry's own, or a playlist's entry
 * @param {Deps} deps
 * @param {{ ask?: boolean, token: number }} how
 */
export async function playMedia(entry, path, deps, how) {
  const { access } = deps;
  const name = nameOf(path);
  const { url, size } = await access.url(path, how.ask ?? true);
  const head = await access.range(path, 0, HEAD).catch(() => null);
  if (entry.token !== how.token) return;
  const found = head ? detect(head.bytes, name) : { format: "", family: familyByName(name) };
  if (found.family === "midi" || found.family === "au")
    return playDecoded(entry, path, size, head?.bytes, deps, how);
  /** @type {Item} */
  const item = {
    path,
    name,
    size,
    url,
    format: containerName(found.format),
    element: videoByName(name) ? "video" : "audio",
    engine: "native",
    engines: [],
  };
  entry.item = item;
  entry.size = entry.path === path ? size : entry.size;
  entry.format = item.format || entry.format;
  const apply = (
    /** @type {{ info?: import("./probe/index.js").Info, problem?: string }} */ result,
  ) => {
    if (result.problem) item.problem = result.problem;
    if (!result.info) {
      if (result.problem)
        plan(entry, item, routeUnread(found.format, result.problem, deps.caps), item.format);
      return;
    }
    const info = result.info;
    item.info = info;
    item.format = info.container;
    item.element = info.video ? "video" : "audio";
    if (entry.item === item) entry.format = info.container;
    plan(entry, item, route(info, deps.caps), info.container);
  };
  entry.mode = "media";
  // Bytes no reader knows go to the webview, and to the decoder after it.
  if (!found.format) plan(entry, item, routeUnread("", "", deps.caps), item.format);
  else {
    const probed = probe(access.source(path, size, head?.bytes), name).then(
      (info) => ({ info }),
      (error) => ({ problem: message(error) }),
    );
    const early = await Promise.race([probed, wait(PROBE_BUDGET_MS)]);
    if (entry.token !== how.token) return;
    if (early) apply(early);
    else
      void probed.then((late) => {
        if (entry.token !== how.token || entry.item !== item) return;
        apply(late);
        deps.show(entry);
      });
  }
}

/**
 * MIDI and AU: read the whole file and decode or render it into a WAV the webview plays.
 * @param {Entry} entry
 * @param {string} path
 * @param {number} size
 * @param {Uint8Array | undefined} head
 * @param {Deps} deps
 * @param {{ token: number }} how
 */
export async function playDecoded(entry, path, size, head, deps, how) {
  const name = nameOf(path);
  const midi =
    detect(head ?? new Uint8Array(0), name).family === "midi" || familyByName(name) === "midi";
  const bytes = await deps.access.all(path, size, midi ? MAX_MIDI : MAX_AU, head);
  if (entry.token !== how.token) return;
  entry.size = entry.path === path ? size : entry.size;
  /** @type {Item} */
  const item = {
    path,
    name,
    size,
    format: midi ? "Standard MIDI File" : "Sun AU",
    element: "audio",
  };
  entry.item = item;
  entry.format = item.format;
  if (!midi) {
    try {
      const au = decodeAu(bytes);
      item.blob = deps.options.objectUrl(au.wav, "audio/wav");
      item.info = {
        format: "au",
        container: "Sun AU",
        mime: "audio/wav",
        video: false,
        duration: au.duration,
        tracks: [
          { kind: "audio", codec: au.encoding, sampleRate: au.sampleRate, channels: au.channels },
        ],
        tags: au.annotation ? { comment: au.annotation } : {},
      };
      entry.mode = "media";
    } catch (error) {
      details(entry, message(error), "Sun AU");
    }
    return;
  }
  let song;
  try {
    song = readMidi(bytes);
  } catch (error) {
    return details(entry, message(error), "Standard MIDI File");
  }
  const create = deps.options.audioContext;
  if (!create)
    return details(entry, "This system has no Web Audio to play MIDI with.", "Standard MIDI File");
  const notes = song.notes.length;
  item.info = {
    format: "midi",
    container: "Standard MIDI File",
    mime: "audio/wav",
    video: false,
    duration: song.duration,
    tracks: [
      {
        kind: "audio",
        codec: "MIDI",
        name: `${notes} notes on ${new Set(song.notes.map((n) => n.channel)).size} channels`,
      },
    ],
    tags: song.title ? { title: song.title } : {},
  };
  entry.mode = "loading";
  entry.message = `Rendering ${name}…`;
  // The visit answers now; the song plays when it is rendered.
  void render(song, create).then(
    (rendered) => {
      if (entry.token !== how.token) return;
      item.blob = deps.options.objectUrl(rendered.wav, "audio/wav");
      entry.mode = "media";
      entry.message = rendered.cut ? `${name} is played up to its first twenty minutes.` : "";
      deps.show(entry);
    },
    (error) => {
      if (entry.token !== how.token) return;
      details(
        entry,
        `The MIDI file could not be rendered: ${message(error)}`,
        "Standard MIDI File",
      );
      deps.show(entry);
    },
  );
}

/** A subtitle file opened alone: its cues with their times. */
export async function openCues(/** @type {Entry} */ entry, /** @type {Uint8Array} */ bytes) {
  const { text } = decodeText(bytes);
  const parsed = looksLikeText(text) ? safely(() => parseSubtitles(text, entry.name)) : null;
  if (!parsed || parsed.cues.length === 0)
    return details(
      entry,
      `${entry.name} has no cues the player can read.`,
      parsed?.name ?? "Subtitles",
    );
  entry.mode = "cues";
  entry.format = parsed.name;
  entry.cues = parsed.cues;
}

/** @template T @param {() => T} run @returns {T | null} */
function safely(run) {
  try {
    return run();
  } catch {
    return null;
  }
}

/** A playlist: its entries, then the first local one plays. */
export function openPlaylist(/** @type {Entry} */ entry, /** @type {Uint8Array} */ bytes) {
  const { text } = decodeText(bytes, "windows-1252");
  const list = looksLikeText(text)
    ? safely(() => parsePlaylist(text, extensionOf(entry.name), entry.path))
    : null;
  const names = {
    m3u: "M3U playlist",
    pls: "PLS playlist",
    xspf: "XSPF playlist",
    cue: "CUE sheet",
  };
  const format = list ? names[/** @type {keyof typeof names} */ (list.format)] : "Playlist";
  if (!list || list.entries.length === 0)
    return details(entry, `${entry.name} lists nothing to play.`, format);
  entry.format = format;
  entry.playlist = { entries: list.entries, states: list.entries.map(() => ""), index: -1 };
}

/**
 * Subtitles with the video's base name in its folder, offered in a menu; a SAMI file offers each of
 * its language classes. The first one is shown.
 * @param {Entry} entry
 * @param {Item} item
 * @param {Deps} deps
 * @param {(entry: Entry, id: string) => Promise<void>} choose
 */
export async function findSubtitles(entry, item, deps, choose) {
  const folder = folderOf(item.path);
  const found = sameName(item.name, await deps.access.list(folder));
  /** @type {{ id: string, label: string }[]} */
  const options = [];
  for (const { name, language } of found) {
    const id = `${folder}/${name}`;
    const label = language ? `${name} (${language})` : name;
    if (!/\.(smi|sami)$/i.test(name)) {
      options.push({ id, label });
      continue;
    }
    const text = await readText(deps, id).catch(() => "");
    const languages = text ? (safely(() => parseSami(text).languages) ?? []) : [];
    if (languages.length < 2) options.push({ id, label });
    else
      for (const l of languages)
        options.push({ id: `${id}#${l.id}`, label: `${name} (${l.name})` });
  }
  if (entry.item !== item) return;
  entry.subs = { options, selected: "", offset: entry.subs?.offset ?? 0, cues: [] };
  if (options[0]) await choose(entry, options[0].id);
}

/** A small text file through fs.read, decoded as subtitles are. */
export async function readText(/** @type {Deps} */ deps, /** @type {string} */ path) {
  const { bytes, size } = await deps.access.range(path, 0, CHUNK);
  const all = size > bytes.length ? await deps.access.all(path, size, MAX_TEXT, bytes) : bytes;
  return decodeText(all).text;
}

/**
 * Show the chosen subtitles ("" for none); a file that cannot be read or has no cues throws.
 * @param {Deps} deps
 * @param {Entry} entry
 * @param {string} id
 */
export async function showSubtitles(deps, entry, id) {
  const subs = entry.subs;
  if (!subs) return;
  if (id === "") {
    subs.selected = "";
    subs.cues = [];
    return;
  }
  subs.cues = await subtitleCues(deps, id);
  subs.selected = id;
}

/** Read and parse the chosen subtitles: a path, with #CLASS for one of a SAMI file's languages. */
export async function subtitleCues(/** @type {Deps} */ deps, /** @type {string} */ id) {
  const [path = "", language] = id.split("#");
  const text = await readText(deps, path);
  const parsed = parseSubtitles(text, nameOf(path), { language });
  if (parsed.cues.length === 0)
    throw new FileError(`${nameOf(path)} has no cues the player can read.`, "empty");
  return parsed.cues;
}
