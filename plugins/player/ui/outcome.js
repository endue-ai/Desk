// What becomes of an item: the engines its route tries (route.js), the next one when an engine fails,
// the details view when none is left or the person cancels the opening, and the sentences the status
// line says when playback goes wrong.
import { cannot } from "./playable.js";

/**
 * @typedef {import("./player.js").Entry} Entry
 * @typedef {import("./player.js").Item} Item
 */

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
export function plan(
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
 * Cancel on the progress bar: an opening stops at the details, an engine where it is (the view
 * unloads it). The sentence to say.
 * @param {Entry} entry
 */
export function cancel(entry) {
  if (entry.mode === "loading") {
    entry.token++;
    details(entry, `Stopped opening ${entry.name}.`, entry.format);
  }
  return SAYINGS.cancelled(entry.item?.name ?? entry.name);
}
