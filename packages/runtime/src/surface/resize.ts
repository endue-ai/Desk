import { MIN, type Rect } from "./geometry";

export const RESIZE_DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type ResizeDirection = (typeof RESIZE_DIRECTIONS)[number];
export const resizeCursor = (direction: ResizeDirection) => {
  if (direction === "n" || direction === "s") return "ns-resize";
  if (direction === "e" || direction === "w") return "ew-resize";
  return direction === "ne" || direction === "sw" ? "nesw-resize" : "nwse-resize";
};

/** Resize the grabbed edges, keeping the opposite edges anchored at minimum size and bounds. */
export function resizeRect(
  start: Rect,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  bounds?: Rect,
): Rect {
  let left = start.x;
  let top = start.y;
  let right = left + start.w;
  let bottom = top + start.h;
  if (direction.includes("w"))
    left = Math.min(right - MIN.w, Math.max(bounds?.x ?? -Infinity, left + dx));
  if (direction.includes("e"))
    right = Math.max(left + MIN.w, Math.min(bounds ? bounds.x + bounds.w : Infinity, right + dx));
  if (direction.includes("n"))
    top = Math.min(bottom - MIN.h, Math.max(bounds?.y ?? -Infinity, top + dy));
  if (direction.includes("s"))
    bottom = Math.max(top + MIN.h, Math.min(bounds ? bounds.y + bounds.h : Infinity, bottom + dy));
  return { x: left, y: top, w: right - left, h: bottom - top };
}
