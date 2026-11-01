/**
 * Snapping: a window dropped at the free area's left or right edge takes that half, one dropped at
 * the top takes the whole area. Pure over rects; Surface.ts asks with the pointer's place.
 */
import type { Rect } from "./geometry";

/** How close to the left or right edge, in pixels, a drop has to be to snap. */
export const SNAP = 24;
/** The top is stricter: a title bar grabbed on a window already at the top sits within 24 px of it. */
export const SNAP_TOP = 8;
const GAP = 12;

/** The two halves of an area, a gap between them. */
export function halves(area: Rect): { left: Rect; right: Rect } {
  const w = Math.floor((area.w - GAP) / 2);
  return {
    left: { x: area.x, y: area.y, w, h: area.h },
    right: { x: area.x + area.w - w, y: area.y, w, h: area.h },
  };
}

/** Where a window dropped with the pointer at `pointer` snaps to, or null when it stays put. */
export function snapFor(
  _rect: Rect,
  pointer: { x: number; y: number },
  area: Rect,
  threshold = SNAP,
): Rect | null {
  if (pointer.y <= area.y + Math.min(threshold, SNAP_TOP)) return { ...area };
  if (pointer.x <= area.x + threshold) return halves(area).left;
  if (pointer.x >= area.x + area.w - threshold) return halves(area).right;
  return null;
}
