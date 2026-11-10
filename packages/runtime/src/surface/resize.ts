/**
 * A window's eight grips and their cursors. The window manager resizes from them (crates/desk-wm's
 * `interact::resize`, ADR 0153); the runtime's own resize went with the windowed desk (#83).
 */
export const RESIZE_DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type ResizeDirection = (typeof RESIZE_DIRECTIONS)[number];
export const resizeCursor = (direction: ResizeDirection) => {
  if (direction === "n" || direction === "s") return "ns-resize";
  if (direction === "e" || direction === "w") return "ew-resize";
  return direction === "ne" || direction === "sw" ? "nesw-resize" : "nwse-resize";
};
