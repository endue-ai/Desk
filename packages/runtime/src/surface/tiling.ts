/**
 * Where plugin windows go when no profile places them: tiled in the free area, in the order the
 * runtime handed them over, as many columns as the square root of their number. Pure, so the shell
 * can lay out from state alone and the tests can check it without a DOM.
 */
import { FREE, type Rect } from "./geometry";

export const GAP = 12;

/** The rects for `n` unplaced windows, reading order; one window takes the whole area. */
export function tiles(n: number, area: Rect = FREE): Rect[] {
  if (n <= 0) return [];
  if (n === 1) return [{ ...area }];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const w = Math.floor((area.w - GAP * (cols - 1)) / cols);
  const h = Math.floor((area.h - GAP * (rows - 1)) / rows);
  return Array.from({ length: n }, (_, i) => ({
    x: area.x + (i % cols) * (w + GAP),
    y: area.y + Math.floor(i / cols) * (h + GAP),
    w,
    h,
  }));
}
