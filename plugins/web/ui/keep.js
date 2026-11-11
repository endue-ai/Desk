// What Web keeps of each open file when the desk puts its window to sleep (ui.surface.state, ADR
// 0070, ADR 0176), through the SDK's keepFiles: where the person was in it (how far down what shows
// it, as a share of its height, and the entry chosen in an archive or a feed) and the file's watch.
// Web reads and never edits, so nothing unsaved is kept.

/**
 * @typedef {{ down: number, entry?: number }} Where
 * @typedef {{ down?: number, entry?: number, watchId?: string }} KeptPlace
 */

/**
 * The place to keep for an open file: `where` the person is (or was) in it.
 * @param {{ watchId?: string }} file
 * @param {Where | undefined} where
 * @returns {KeptPlace}
 */
export const placeOf = ({ watchId }, where) => ({
  ...(where ? { down: where.down } : {}),
  ...(where?.entry !== undefined ? { entry: where.entry } : {}),
  ...(watchId ? { watchId } : {}),
});

/**
 * A kept place as Web keeps one, or undefined (another version's).
 * @param {unknown} value
 * @returns {KeptPlace | undefined}
 */
export function readPlace(value) {
  const place = /** @type {{ down?: unknown, entry?: unknown, watchId?: unknown } | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (!place) return undefined;
  const { down, entry } = place;
  return {
    ...(typeof down === "number" && Number.isFinite(down)
      ? { down: Math.max(0, Math.min(1, down)) }
      : {}),
    ...(Number.isInteger(entry) && /** @type {number} */ (entry) >= 0
      ? { entry: /** @type {number} */ (entry) }
      : {}),
    ...(typeof place.watchId === "string" ? { watchId: place.watchId } : {}),
  };
}
