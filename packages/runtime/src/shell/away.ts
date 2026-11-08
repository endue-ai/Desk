/**
 * The drawer holds only what is away (#4): a surface that a desktop's layout places is never in the
 * drawer too. The store applies this after every change (state.ts), so a profile switched back to,
 * a restored session, layouts set from settings and an open all leave the drawer right without each
 * of them saying so. Before, a surface that came back other than through the drawer stayed in it.
 */
import { desktopsOf, layoutOf } from "./actions";
import type { DeskState } from "./state";

/** What decides which surfaces the desktops place, and the drawer itself. */
const INPUTS = ["drawer", "session", "desktops", "modes", "modeId"] as const;

/** `next` without the drawer items whose surface some desktop places; `next` itself when none is. */
export function keepAway(next: DeskState, previous?: DeskState): DeskState {
  if (previous && INPUTS.every((key) => next[key] === previous[key])) return next;
  if (!next.drawer.some((d) => d.placement)) return next;
  const placed = new Set(
    desktopsOf(next).flatMap((d) => layoutOf(next, d.id).surfaces.map((p) => p.id)),
  );
  const drawer = next.drawer.filter((d) => !d.placement || !placed.has(d.placement.id));
  return drawer.length === next.drawer.length ? next : { ...next, drawer };
}
