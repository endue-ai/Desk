// What the reader keeps of each open file when the desk puts its window to sleep (ui.surface.state,
// ADR 0070, ADR 0176), through the SDK's keepFiles: the page or chapter and the place in it, the zoom
// and the file's watch. Bookmarks and notes are in the reader's store already (marks.js), and the
// store's position may lag a scroll by POSITION_DELAY; a password is never kept, so a locked PDF asks
// for it again.

/**
 * @typedef {import("./marks.js").At} At
 * @typedef {{ at: At, zoom: number | null, watchId?: string }} KeptPlace
 */

/**
 * The place to keep for an open file.
 * @param {{ at: At, zoom: number | null, watchId?: string }} file
 * @returns {KeptPlace}
 */
export const placeOf = ({ at, zoom, watchId }) => ({
  at: { unit: at.unit, offset: at.offset },
  zoom,
  ...(watchId ? { watchId } : {}),
});

/**
 * A kept place as the reader keeps one, or undefined (another version's).
 * @param {unknown} value
 * @returns {KeptPlace | undefined}
 */
export function readPlace(value) {
  const place = /** @type {{ at?: Partial<At>, zoom?: unknown, watchId?: unknown } | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  const unit = place?.at?.unit;
  const offset = place?.at?.offset;
  if (!Number.isInteger(unit) || /** @type {number} */ (unit) < 0 || typeof offset !== "number")
    return undefined;
  const zoom = typeof place?.zoom === "number" && place.zoom > 0 ? place.zoom : null;
  return {
    at: { unit: /** @type {number} */ (unit), offset: Math.max(0, Math.min(1, offset)) },
    zoom,
    ...(typeof place?.watchId === "string" ? { watchId: place.watchId } : {}),
  };
}
