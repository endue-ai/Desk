// How the dock's row scrolls: a wheel moves it, and a tile that takes the focus comes into sight.
// The row only runs sideways, so a vertical wheel, a mouse's ordinary one, moves it too. Plain
// numbers in and out, so it is tested without a DOM.

/** Pixels per line of a wheel that counts lines (WheelEvent.deltaMode 1). */
const LINE = 16;

/**
 * How far a wheel moves the row sideways, in pixels: its vertical turn when that is the larger one,
 * else nothing, since a sideways wheel or swipe scrolls the row by itself.
 * @param {{ deltaX: number, deltaY: number, deltaMode: number }} wheel
 * @param {number} page the row's visible width, for a wheel that counts pages (deltaMode 2)
 */
export function sideways(wheel, page) {
  if (Math.abs(wheel.deltaY) <= Math.abs(wheel.deltaX)) return 0;
  const unit = wheel.deltaMode === 1 ? LINE : wheel.deltaMode === 2 ? page : 1;
  return wheel.deltaY * unit;
}

/**
 * How far to scroll the row so a tile lies wholly inside the part of the strip that shows tiles:
 * nothing when it does already. The engine scrolls a focused element only until some of it shows.
 * @param {{ left: number, right: number }} tile
 * @param {{ left: number, right: number }} shown
 */
export function intoSight(tile, shown) {
  if (tile.left < shown.left) return tile.left - shown.left;
  if (tile.right > shown.right) return tile.right - shown.right;
  return 0;
}
