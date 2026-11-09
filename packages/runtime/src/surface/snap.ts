/**
 * Snapping: a window dragged to one of the app's four edges takes that half of the free area
 * (between the bars, `freeArea`), one dragged to a corner takes that quarter. Pure over rects;
 * interactions.ts asks with the pointer's place, shows the rect while the pointer is there, and the
 * window keeps the fill (`SurfacePlacement.fill`) so it still fills after the app is resized.
 */
import type { SurfacePlacement } from "../modes/types";
import type { Rect } from "./geometry";

export type Fill = NonNullable<SurfacePlacement["fill"]>;
/** The parts of the free area a drag can snap to: every fill but the whole of it. */
export type Snap = Exclude<Fill, "full">;

interface Point {
  x: number;
  y: number;
}

/**
 * How close to the left, right or bottom edge, in pixels, the pointer has to come to snap. A
 * pointer past the edge (outside a windowed app) is as close as can be.
 */
export const SNAP = 24;
/** The top is stricter: a window moved up under the bars, not at them, keeps its place. */
export const SNAP_TOP = 8;
/** How far from a corner along an edge, in pixels, the pointer takes the corner's quarter. */
export const CORNER = 120;
/** Between the two halves, or the four quarters, of the area. */
const GAP = 12;

/** The two halves of an area side by side, a gap between them. */
export function halves(area: Rect): { left: Rect; right: Rect } {
  const w = Math.floor((area.w - GAP) / 2);
  return {
    left: { x: area.x, y: area.y, w, h: area.h },
    right: { x: area.x + area.w - w, y: area.y, w, h: area.h },
  };
}

/**
 * The two halves of an area one above the other. The bottom one sits exactly a gap below the top
 * one, both one height, so a bottom fill tells the top of its area (`fillTop`).
 */
export function rows(area: Rect): { top: Rect; bottom: Rect } {
  const h = Math.floor((area.h - GAP) / 2);
  return {
    top: { x: area.x, y: area.y, w: area.w, h },
    bottom: { x: area.x, y: area.y + h + GAP, w: area.w, h },
  };
}

const isBottom = (fill: Fill) => fill === "bottom" || fill.startsWith("bottom-");

/** The part of `area` a fill takes. */
export function fillRect(fill: Fill, area: Rect): Rect {
  if (fill === "full") return { ...area };
  const { left, right } = halves(area);
  const { top, bottom } = rows(area);
  switch (fill) {
    case "left":
      return left;
    case "right":
      return right;
    case "top":
      return top;
    case "bottom":
      return bottom;
    default: {
      const column = fill.endsWith("-left") ? left : right;
      const row = isBottom(fill) ? bottom : top;
      return { x: column.x, y: row.y, w: column.w, h: row.h };
    }
  }
}

/** The top of the free area a fill's rect `r` was taken from: its own, or a bottom one's top half's. */
export function fillTop(fill: Fill, r: Rect): number {
  return isBottom(fill) ? r.y - GAP - r.h : r.y;
}

/** Which part a window dragged with the pointer at `pointer` snaps to, or null when it stays put. */
export function snapFor(pointer: Point, area: Rect, threshold = SNAP): Snap | null {
  const left = pointer.x <= area.x + threshold;
  const right = pointer.x >= area.x + area.w - threshold;
  const top = pointer.y <= area.y + Math.min(threshold, SNAP_TOP);
  const bottom = pointer.y >= area.y + area.h - threshold;
  if (!(left || right || top || bottom)) return null;
  // Along an edge, the last stretch before a corner is the corner's: a quarter of the edge at most.
  const reachX = Math.min(CORNER, area.w / 4);
  const reachY = Math.min(CORNER, area.h / 4);
  const nearLeft = left || pointer.x <= area.x + reachX;
  const nearRight = right || pointer.x >= area.x + area.w - reachX;
  const nearTop = top || pointer.y <= area.y + reachY;
  const nearBottom = bottom || pointer.y >= area.y + area.h - reachY;
  if ((left || top) && nearLeft && nearTop) return "top-left";
  if ((right || top) && nearRight && nearTop) return "top-right";
  if ((left || bottom) && nearLeft && nearBottom) return "bottom-left";
  if ((right || bottom) && nearRight && nearBottom) return "bottom-right";
  if (left) return "left";
  if (right) return "right";
  return top ? "top" : "bottom";
}

/**
 * A drag's aim: the part it snaps to while the pointer is at `pointer`. The pointer has to come to
 * the edge from inside the app: a drag that starts in a zone (a title bar grabbed on a window that
 * sits at an edge) aims at nothing until the pointer has left every zone once.
 */
export function aimSnap(from: Point, area: Rect): (pointer: Point, now?: Rect) => Snap | null {
  let armed = snapFor(from, area) === null;
  return (pointer, now = area) => {
    const snap = snapFor(pointer, now);
    if (!snap) armed = true;
    return armed ? snap : null;
  };
}
