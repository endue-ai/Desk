/**
 * Snapping: a window dropped at the app's left or right edge takes that half, one dropped at the
 * top fills the whole app. Pure over rects; interactions.ts asks with the pointer's place, and the
 * window keeps the fill (`SurfacePlacement.fill`) so it still fills after the app is resized.
 */
import type { SurfacePlacement } from "../modes/types";
import type { Rect } from "./geometry";

export type Fill = NonNullable<SurfacePlacement["fill"]>;

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

/** The part of `area` a fill takes. */
export function fillRect(fill: Fill, area: Rect): Rect {
  return fill === "full" ? { ...area } : halves(area)[fill];
}

/** Which fill a window dropped with the pointer at `pointer` takes, or null when it stays put. */
export function snapFor(
  pointer: { x: number; y: number },
  area: Rect,
  threshold = SNAP,
): Fill | null {
  if (pointer.y <= area.y + Math.min(threshold, SNAP_TOP)) return "full";
  if (pointer.x <= area.x + threshold) return "left";
  if (pointer.x >= area.x + area.w - threshold) return "right";
  return null;
}
