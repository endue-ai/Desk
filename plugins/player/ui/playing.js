// What plays an open file: its own media, or a playlist's entries one at a time, opened by what the
// file is (load.js), with the subtitles found next to a video and the resume offer. What the status
// line says is about the item that plays: an earlier item's words go. An entry that cannot be read
// leaves the item before it as it was, and the person who chose it is told why (#162, finding 17).
import { codeOf } from "./access.js";
import { detect, familyByName } from "./format.js";
import {
  findSubtitles,
  HEAD,
  openCues,
  openPlaylist,
  playDecoded,
  playMedia,
  showSubtitles,
} from "./load.js";
import { details } from "./outcome.js";

/**
 * @typedef {import("./player.js").Entry} Entry
 * @typedef {import("./keep.js").KeptPlace} KeptPlace
 * @typedef {{ ask?: boolean, place?: KeptPlace }} How
 *   ask: false as the window wakes, which asks the person nothing; place: where a sleep left it.
 */

const text = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/** The indexes from `from` in direction `step` inside `length`; a step of 0 is `from` alone. */
function* walk(
  /** @type {number} */ from,
  /** @type {number} */ step,
  /** @type {number} */ length,
) {
  for (let i = from; i >= 0 && i < length; i += step) {
    yield i;
    if (step === 0) return;
  }
}

/**
 * @param {{ deps: import("./load.js").Deps, resume: ReturnType<typeof import("./resume.js").createResume>,
 *   say(words: string): void }} parts
 */
export function createPlaying({ deps, resume, say }) {
  const { access } = deps;

  /** Show the chosen subtitles ("" for none). */
  const choose = (/** @type {Entry} */ entry, /** @type {string} */ id) =>
    showSubtitles(deps, entry, id).catch((error) => say(text(error)));

  /**
   * Play one item of the entry (its own file, or a playlist entry) and find its subtitles. An item
   * that does not open throws, and the item before it stays.
   * @param {Entry} entry
   * @param {string} path
   * @param {How} [how]
   */
  const play = async (entry, path, how = {}) => {
    const token = ++entry.token;
    const { item: was, subs, why, mode, format } = entry;
    entry.item = undefined;
    entry.subs = undefined;
    entry.why = undefined;
    try {
      await playMedia(entry, path, deps, { token, ask: how.ask });
    } catch (error) {
      if (entry.token === token) Object.assign(entry, { item: was, subs, why, mode, format });
      throw error;
    }
    if (was?.blob && entry.item !== was) deps.options.revokeUrl(was.blob);
    if (entry.token !== token) return;
    const item = entry.item;
    say(entry.mode === "details" ? (entry.why ?? "") : "");
    if (!entry.playlist) entry.resume = entry.position > 0 ? null : resume.offer(path);
    if (item && entry.mode === "media" && item.element === "video")
      await findSubtitles(entry, item, deps, choose, how.place);
  };

  /**
   * Play the playlist's first playable local entry from `from` in direction `step` (0: that entry
   * alone). Null when one plays; else why the last one tried did not, "" when none was tried.
   * @param {Entry} entry
   * @param {number} from
   * @param {number} [step]
   * @param {How} [how]
   * @returns {Promise<string | null>}
   */
  const playEntry = async (entry, from, step = 1, how = {}) => {
    const list = entry.playlist;
    if (!list) return "";
    let why = "";
    for (const i of walk(from, step, list.entries.length)) {
      const target = list.entries[i];
      if (!target?.path || target.remote || list.states[i]) continue;
      const [index, position] = [list.index, entry.position];
      const place = how.place?.entry === i ? how.place : undefined;
      list.index = i;
      entry.position = place?.position ?? 0;
      try {
        await play(entry, target.path, { ask: how.ask, place });
        return null;
      } catch (error) {
        const code = codeOf(error);
        list.states[i] =
          code === "not_found"
            ? "Not found"
            : code === "permission_denied"
              ? "Not allowed"
              : "Could not open";
        list.index = index;
        entry.position = position;
        why = text(error);
      }
    }
    return why;
  };

  /**
   * Open the entry's file by what it is.
   * @param {Entry} entry
   * @param {How} [how]
   */
  const load = async (entry, how = {}) => {
    const { path, name } = entry;
    if (familyByName(name) === "media") return play(entry, path, how);
    const token = ++entry.token;
    const head = await access.range(path, 0, HEAD, how.ask ?? true);
    entry.size = head.size;
    const found = detect(head.bytes, name);
    if (found.family === "media") return play(entry, path, how);
    if (found.family === "midi" || found.family === "au")
      return playDecoded(entry, path, head.size, head.bytes, deps, { token });
    const all =
      head.size > head.bytes.length
        ? await access.all(path, head.size, 16 << 20, head.bytes)
        : head.bytes;
    if (found.family === "subtitles") return openCues(entry, all);
    if (found.family === "playlist") {
      openPlaylist(entry, all);
      // Back from a sleep it goes on with the entry it was playing, else from the first.
      const start = how.place?.entry ?? 0;
      const played =
        (await playEntry(entry, start, 1, how)) === null ||
        (start > 0 && (await playEntry(entry, 0, 1, how)) === null);
      if (entry.playlist && !played)
        details(
          entry,
          `Nothing in ${name} can be played here: its entries are remote, missing or not allowed.`,
          entry.format,
        );
      return;
    }
    details(entry, `${name} is not a file the player knows.`, "Unknown");
  };

  return { choose, play, playEntry, load };
}
