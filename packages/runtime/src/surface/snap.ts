/**
 * The parts of the app a filled window takes: a half, a quarter (ADR 0128) or the whole app, the
 * bars floating above it (ADR 0132). The window keeps the fill (`SurfacePlacement.fill`), so the
 * page lays it out in its part after the app is resized. Where a drag snaps to is the window
 * manager's (crates/desk-wm's `snap_for` and its aim, ADR 0153; the runtime's went with #83).
 */
import type { SurfacePlacement } from "../modes/types";
import type { Rect } from "./geometry";

export type Fill = NonNullable<SurfacePlacement["fill"]>;
/** The parts of the app a drag can snap to: every fill but the whole of it. */
export type Snap = Exclude<Fill, "full">;

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

/** The two halves of an area one above the other, a gap between them. */
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
