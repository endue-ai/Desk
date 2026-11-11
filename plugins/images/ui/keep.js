// What Images keeps of each open file when the desk puts its window to sleep (ui.surface.state, ADR
// 0070, ADR 0176), through the SDK's keepFiles: its watch, and for the image on screen the view's
// zoom, pan and turn (viewer.js). An image not on screen comes back fitted, as a switch to it does.

/**
 * @typedef {{ zoom: "fit" | number, x: number, y: number, rotation: number, flipped: boolean }} ViewPlace
 * @typedef {{ view?: ViewPlace, watchId?: string }} KeptPlace
 */

const finite = (/** @type {unknown} */ v) => typeof v === "number" && Number.isFinite(v);

/**
 * A kept view as the viewer keeps one, or undefined (another version's).
 * @param {unknown} value
 * @returns {ViewPlace | undefined}
 */
export function readView(value) {
  const view = /** @type {Partial<Record<keyof ViewPlace, unknown>> | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (!view) return undefined;
  const { zoom, x, y, rotation, flipped } = view;
  const scale = zoom === "fit" || (finite(zoom) && /** @type {number} */ (zoom) > 0);
  if (
    !scale ||
    !finite(x) ||
    !finite(y) ||
    ![0, 90, 180, 270].includes(/** @type {number} */ (rotation))
  )
    return undefined;
  return {
    zoom: /** @type {"fit" | number} */ (zoom),
    x: /** @type {number} */ (x),
    y: /** @type {number} */ (y),
    rotation: /** @type {number} */ (rotation),
    flipped: flipped === true,
  };
}

/**
 * A kept place as Images keeps one; what it cannot read is left out.
 * @param {unknown} value
 * @returns {KeptPlace | undefined}
 */
export function readPlace(value) {
  if (typeof value !== "object" || value === null) return undefined;
  const { view, watchId } = /** @type {{ view?: unknown, watchId?: unknown }} */ (value);
  const kept = view === undefined ? undefined : readView(view);
  return {
    ...(kept ? { view: kept } : {}),
    ...(typeof watchId === "string" ? { watchId } : {}),
  };
}
