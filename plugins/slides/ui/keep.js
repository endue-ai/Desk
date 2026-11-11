// What Slides keeps of each open presentation when the desk puts its window to sleep
// (ui.surface.state, ADR 0070, ADR 0176), through the SDK's keepFiles: the slide the person was on
// and the file's watch. Slides reads and never edits, so nothing unsaved is kept; play mode is left.

/** @typedef {{ slide?: number, watchId?: string }} KeptPlace */

/**
 * The place to keep for an open presentation: the slide the view last showed of it, if any.
 * @param {{ watchId?: string }} file
 * @param {number | undefined} slide
 * @returns {KeptPlace}
 */
export const placeOf = ({ watchId }, slide) => ({
  ...(slide !== undefined ? { slide } : {}),
  ...(watchId ? { watchId } : {}),
});

/**
 * A kept place as Slides keeps one, or undefined (another version's).
 * @param {unknown} value
 * @returns {KeptPlace | undefined}
 */
export function readPlace(value) {
  const place = /** @type {{ slide?: unknown, watchId?: unknown } | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (!place) return undefined;
  const slide = place.slide;
  return {
    ...(Number.isInteger(slide) && /** @type {number} */ (slide) >= 0
      ? { slide: /** @type {number} */ (slide) }
      : {}),
    ...(typeof place.watchId === "string" ? { watchId: place.watchId } : {}),
  };
}
