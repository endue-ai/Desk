// What the player keeps of each open file when the desk puts its window to sleep (ui.surface.state,
// ADR 0070, ADR 0176), through the SDK's keepFiles: the position, a playlist's entry, the subtitles
// chosen and their offset, and the file's watch. It comes back there paused: a window that slept out
// of sight does not start to play by itself. The volume is the view's own (store), and long files'
// resume points are kept in the store already (resume.js).

/**
 * @typedef {import("./player.js").Entry} Entry
 * @typedef {{ position: number, entry?: number, subtitle?: string, offset?: number,
 *   watchId?: string }} KeptPlace
 *   entry: the playlist's entry playing; subtitle: the subtitles chosen, "" for none.
 */

/** Seconds kept to the millisecond: enough to come back to the frame. */
const seconds = (/** @type {number} */ value) =>
  Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : 0;

/**
 * The place to keep for an open file.
 * @param {Entry} entry
 * @returns {KeptPlace}
 */
export function placeOf(entry) {
  const index = entry.playlist?.index ?? -1;
  const subs = entry.subs;
  return {
    position: seconds(entry.position),
    ...(index >= 0 ? { entry: index } : {}),
    ...(subs ? { subtitle: subs.selected, offset: subs.offset } : {}),
    ...(entry.watchId ? { watchId: entry.watchId } : {}),
  };
}

/**
 * A kept place as the player keeps one, or undefined (another version's).
 * @param {unknown} value
 * @returns {KeptPlace | undefined}
 */
export function readPlace(value) {
  const place = /** @type {Partial<Record<keyof KeptPlace, unknown>> | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (typeof place?.position !== "number") return undefined;
  const { entry, subtitle, offset, watchId } = place;
  return {
    position: seconds(place.position),
    ...(Number.isInteger(entry) && /** @type {number} */ (entry) >= 0
      ? { entry: /** @type {number} */ (entry) }
      : {}),
    ...(typeof subtitle === "string" ? { subtitle } : {}),
    ...(typeof offset === "number" && Number.isFinite(offset)
      ? { offset: Math.round(offset * 10) / 10 }
      : {}),
    ...(typeof watchId === "string" ? { watchId } : {}),
  };
}
