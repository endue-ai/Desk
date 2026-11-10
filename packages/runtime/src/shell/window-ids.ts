/**
 * Window ids are the desk's, not a desktop's (issue 101): the drawer (#4), the closed list (ADR
 * 0124) and desk.windows.list know a window by its id alone, so no two windows anywhere share one.
 * The window manager names every id the desk has (crates/desk-wm `window_ids`, #83).
 */
import type { DeskState } from "./state";

/** Every window id on the desk, as the window manager published it. */
export function windowIds(s: DeskState): Set<string> {
  return new Set(s.wm.ids);
}

/** The first `window-<n>` not in `taken` (the desk's `windowIds`). */
export function freeWindowId(taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`window-${n}`)) n++;
  return `window-${n}`;
}
