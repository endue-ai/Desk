/**
 * Moving a window to another desktop (ADR 0117), as a change of the desk's state: it leaves one
 * desktop's layout and joins the other's with the same size and the same place on screen, and it is
 * the window in use there. What `moved` records takes it back (`movedBack`).
 */
import type { DesktopId, DesktopLayout, DesktopRef, SurfacePlacement } from "../modes/types";
import { desktopId, desktopsOf, layoutOf, windowsOf } from "../shell/actions";
import type { DeskState } from "../shell/state";
import { isFloating } from "../surface/coordinates";
import { idAt } from "./model";

/** One move, enough to take it back. */
export interface Moved {
  window: string;
  from: DesktopId;
  to: DesktopId;
  /** Where it was, in the first desktop's canvas. */
  placement: SurfacePlacement;
  /** It was a plugin window in its slot on every desktop, in no layout. */
  slotted: boolean;
  /** It was the window in use. */
  focused: boolean;
}

const ORIGIN = { x: 0, y: 0 };

/** The desktop that shows `window`: the one in front first, then the others in order. */
export function holderOf(s: DeskState, window: string): DesktopId | undefined {
  const here = desktopId(s);
  if (windowsOf(s, here).some((p) => p.id === window)) return here;
  return desktopsOf(s).find((d) => layoutOf(s, d.id).surfaces.some((p) => p.id === window))?.id;
}

/** A normal window keeps its place on screen across two canvases panned differently. */
export function onScreen(
  p: SurfacePlacement,
  s: DeskState,
  from: DesktopId,
  to: DesktopId,
): SurfacePlacement {
  if (isFloating(p)) return { ...p };
  const a = s.pan[from] ?? ORIGIN;
  const b = s.pan[to] ?? ORIGIN;
  return { ...p, x: p.x + a.x - b.x, y: p.y + a.y - b.y };
}

/** The session with `window` out of `from` and, when given, `placement` on `to` in its place. */
function relocate(
  s: DeskState,
  window: string,
  from: DesktopId,
  to: DesktopId,
  placement: SurfacePlacement | null,
): DeskState["session"] {
  const session = { ...s.session };
  const out = layoutOf(s, from);
  if (out.surfaces.some((p) => p.id === window))
    session[from] = { ...out, surfaces: out.surfaces.filter((p) => p.id !== window) };
  if (placement) {
    const into: DesktopLayout = layoutOf({ ...s, session }, to);
    session[to] = {
      ...into,
      surfaces: [...into.surfaces.filter((p) => p.id !== window), structuredClone(placement)],
    };
  } else if (layoutOf(s, to).surfaces.some((p) => p.id === window)) {
    const back = layoutOf(s, to);
    session[to] = { ...back, surfaces: back.surfaces.filter((p) => p.id !== window) };
  }
  return session;
}

/** Who has the focus after `window` went from one desktop to another. */
function refocus(
  s: DeskState,
  window: string,
  from: DesktopId,
  to: DesktopId,
  pane: string | null,
): Pick<DeskState, "focused" | "pane" | "focusBy"> {
  const here = desktopId(s);
  const { [from]: left, [to]: _old, ...focusBy } = s.focusBy;
  if (left && left.window !== window) focusBy[from] = left;
  if (to === here) return { focused: window, pane, focusBy };
  focusBy[to] = { window, pane };
  const lost = from === here && s.focused === window;
  return { focused: lost ? null : s.focused, pane: lost ? null : s.pane, focusBy };
}

/**
 * Move `window` to desktop `to`. `before` is where it was before a drag that ends on a desktop: it
 * lands there, not under the pointer. Undefined when there is nothing to move.
 */
export function moveWindow(
  s: DeskState,
  window: string,
  to: DesktopRef,
  before?: SurfacePlacement,
): { patch: Partial<DeskState>; moved: Moved } | undefined {
  const from = holderOf(s, window);
  const target = idAt(desktopsOf(s), to);
  if (!from || !target || from === target) return undefined;
  const shown = windowsOf(s, from).find((p) => p.id === window);
  const placed = layoutOf(s, from).surfaces.find((p) => p.id === window);
  const was = before ?? placed ?? shown;
  if (!was) return undefined;
  const focused = s.focused === window && from === desktopId(s);
  const pane = focused ? s.pane : s.focusBy[from]?.window === window ? s.focusBy[from]?.pane : null;
  const session = relocate(s, window, from, target, onScreen(was, s, from, target));
  return {
    patch: { session, ...refocus(s, window, from, target, pane ?? null) },
    moved: { window, from, to: target, placement: structuredClone(was), slotted: !placed, focused },
  };
}

/** Take a move back: the window returns where it was, and is in use again if it was. */
export function movedBack(s: DeskState, moved: Moved): Partial<DeskState> | undefined {
  const list = desktopsOf(s);
  if (!idAt(list, moved.from) || !idAt(list, moved.to)) return undefined;
  if (!layoutOf(s, moved.to).surfaces.some((p) => p.id === moved.window)) return undefined;
  const session = relocate(
    s,
    moved.window,
    moved.to,
    moved.from,
    moved.slotted ? null : moved.placement,
  );
  // relocate took it out of `to`; a slotted window goes back to its slot on every desktop.
  const here = desktopId(s);
  const { [moved.to]: kept, ...focusBy } = s.focusBy;
  if (kept && kept.window !== moved.window) focusBy[moved.to] = kept;
  if (moved.focused && moved.from === here) return { session, focused: moved.window, focusBy };
  if (moved.focused) focusBy[moved.from] = { window: moved.window, pane: null };
  const lost = s.focused === moved.window && moved.to === here;
  return { session, focusBy, ...(lost ? { focused: null, pane: null } : {}) };
}
