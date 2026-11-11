// What Docs keeps of each open document when the desk puts its window to sleep (ui.surface.state,
// ADR 0070, ADR 0176), through the SDK's keepFiles: where the person was in it (the page at the top of
// the view, how far down that page and how far across the sheet), the zoom they chose for the view
// (only with the document on screen: the zoom is the view's, not a document's) and the file's watch.
// Docs reads and never edits, so nothing unsaved is kept.

/**
 * @typedef {{ page: number, down: number, across: number }} At
 * @typedef {{ at?: At, zoom?: number, watchId?: string }} KeptPlace
 */

const share = (/** @type {unknown} */ v) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;

/**
 * The place to keep for an open document: `at` and `zoom` from the view for the one on screen.
 * @param {{ at?: At, watchId?: string }} doc
 * @param {{ at: At | null, zoom: number | null }} [view]
 * @returns {KeptPlace}
 */
export function placeOf({ at, watchId }, view) {
  const where = view?.at ?? at;
  return {
    ...(where ? { at: { page: where.page, down: where.down, across: where.across } } : {}),
    ...(typeof view?.zoom === "number" ? { zoom: view.zoom } : {}),
    ...(watchId ? { watchId } : {}),
  };
}

/**
 * A kept place as Docs keeps one, or undefined (another version's).
 * @param {unknown} value
 * @returns {KeptPlace | undefined}
 */
export function readPlace(value) {
  const place = /** @type {{ at?: Partial<At>, zoom?: unknown, watchId?: unknown } | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (!place) return undefined;
  const page = place.at?.page;
  const at =
    Number.isInteger(page) && /** @type {number} */ (page) >= 0
      ? {
          page: /** @type {number} */ (page),
          down: share(place.at?.down),
          across: share(place.at?.across),
        }
      : undefined;
  const zoom = typeof place.zoom === "number" && place.zoom > 0 ? place.zoom : undefined;
  return {
    ...(at ? { at } : {}),
    ...(zoom ? { zoom } : {}),
    ...(typeof place.watchId === "string" ? { watchId: place.watchId } : {}),
  };
}
