/**
 * Window ids are the desk's, not a desktop's (issue 101): the drawer (#4), the closed list (ADR
 * 0124) and desk.windows.list know a window by its id alone, so no two windows anywhere share one.
 * Before, ⌘N looked at the desktop in front only: two desktops could each hold a `window-1`, and a
 * window put away while the other desktop placed its namesake left the drawer at once.
 */
import { desktopsOf, layoutOf, windowsOf } from "./actions";
import type { DeskState } from "./state";

/**
 * Every window id on the desk: on each desktop, drawn or placed while its plugin is away (it comes
 * back there), the plugin windows in their slots, and the windows in the drawer.
 */
export function windowIds(s: DeskState): Set<string> {
  return new Set([
    ...desktopsOf(s).flatMap((d) =>
      [...layoutOf(s, d.id).surfaces, ...windowsOf(s, d.id)].map((p) => p.id),
    ),
    ...s.drawer.flatMap((d) => (d.placement ? [d.placement.id] : [])),
  ]);
}

/** The first `window-<n>` not in `taken` (the desk's `windowIds`). */
export function freeWindowId(taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`window-${n}`)) n++;
  return `window-${n}`;
}
