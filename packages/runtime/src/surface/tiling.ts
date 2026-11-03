/**
 * Where plugin windows go when no profile places them: each into its own slot, given when the
 * runtime hands its surface over and kept while it stays mounted. A slot's rect never depends on
 * the other windows, so a window never moves or resizes because another one arrived, moved or
 * closed. Six slots of one size fill the free area, three by two in reading order; the next six
 * cascade over them. Pure, so the shell can lay out from state alone and the tests need no DOM.
 */
import { FREE, type Rect } from "./geometry";

export const GAP = 12;
const COLS = 3;
const ROWS = 2;
/** How far each further six step down and right over the first. */
export const CASCADE = 32;

/** The rect of slot `n` (from 0) in `area`. */
export function slotRect(n: number, area: Rect = FREE): Rect {
  const w = Math.floor((area.w - GAP * (COLS - 1)) / COLS);
  const h = Math.floor((area.h - GAP * (ROWS - 1)) / ROWS);
  const i = n % (COLS * ROWS);
  const step = Math.floor(n / (COLS * ROWS)) * CASCADE;
  return {
    x: area.x + (i % COLS) * (w + GAP) + step,
    y: area.y + Math.floor(i / COLS) * (h + GAP) + step,
    w,
    h,
  };
}

/** The first slot none of `taken` holds. */
export function freeSlot(taken: Iterable<number>): number {
  const held = new Set(taken);
  let n = 0;
  while (held.has(n)) n++;
  return n;
}
