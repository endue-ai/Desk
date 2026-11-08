/**
 * The desktops' list changes as changes of the desk's state (ADR 0117): add, rename, remove and
 * reorder. They are unsaved changes to the profile in force, like moved windows: saving keeps them,
 * reverting drops them. Every desktop keeps its own layout, pan and window in use.
 */
import type { Desktop, DesktopId, DesktopRef, SurfacePlacement } from "../modes/types";
import { baseOf, desktopId, desktopsOf, layoutOf, modeOf } from "../shell/actions";
import type { DeskState } from "../shell/state";
import { added, idAt, moved, neighbourOf, removed, renamed, sameList } from "./model";
import { onScreen } from "./move";

/** The list as the state keeps it: null once it is the profile's own again. */
export function listPatch(s: DeskState, list: Desktop[]): Pick<DeskState, "desktops"> {
  return { desktops: sameList(list, modeOf(s).list) ? null : list };
}

/** Ids a new desktop must not take: any a layout, a pan or a kept focus still names. */
function taken(s: DeskState): string[] {
  const mode = modeOf(s);
  return [
    ...mode.list.map((d) => d.id),
    ...Object.keys(mode.desktops),
    ...Object.keys(baseOf(s)?.desktops ?? {}),
    ...Object.keys(s.session),
    ...Object.keys(s.pan),
    ...Object.keys(s.focusBy),
  ];
}

/** A new desktop at the end of the list; undefined at the cap. */
export function addDesktop(
  s: DeskState,
  name?: string,
): { patch: Partial<DeskState>; id: DesktopId } | undefined {
  const next = added(desktopsOf(s), taken(s), name);
  return next && { patch: listPatch(s, next.list), id: next.id };
}

export function renameDesktop(s: DeskState, desktop: DesktopRef, name: string): Partial<DeskState> {
  const id = idAt(desktopsOf(s), desktop);
  return id ? listPatch(s, renamed(desktopsOf(s), id, name)) : {};
}

/** Move a desktop to position `to` (from 1). */
export function reorderDesktop(s: DeskState, desktop: DesktopRef, to: number): Partial<DeskState> {
  const id = idAt(desktopsOf(s), desktop);
  return id ? listPatch(s, moved(desktopsOf(s), id, to)) : {};
}

export interface Removal {
  patch: Partial<DeskState>;
  /** Where its windows went ("move"), or the windows that closed ("close"). */
  into?: DesktopId;
  closed: SurfacePlacement[];
}

/**
 * Remove a desktop. Its windows move to its neighbour (the desktop before it, or after it when it is
 * first) or close; the desk goes to the neighbour when it was in front. The last desktop stays.
 */
export function removeDesktop(
  s: DeskState,
  desktop: DesktopRef,
  windows: "move" | "close",
): Removal | undefined {
  const list = desktopsOf(s);
  const id = idAt(list, desktop);
  const into = id && neighbourOf(list, id);
  if (!id || !into || list.length <= 1) return undefined;
  const own = layoutOf(s, id).surfaces;
  const { [id]: _gone, ...session } = s.session;
  if (windows === "move" && own.length) {
    const there = layoutOf(s, into);
    const arriving = own.map((p) => onScreen(p, s, id, into));
    const ids = new Set(arriving.map((p) => p.id));
    session[into] = {
      ...there,
      surfaces: [...there.surfaces.filter((p) => !ids.has(p.id)), ...arriving],
    };
  }
  const { [id]: _pan, ...pan } = s.pan;
  const { [id]: kept, ...focusBy } = s.focusBy;
  const here = desktopId(s) === id;
  if (windows === "move" && kept && !here && !focusBy[into]) focusBy[into] = kept;
  return {
    patch: {
      ...listPatch(s, removed(list, id)),
      session,
      pan,
      focusBy,
      ...(here ? { desktop: into, focused: windows === "move" ? s.focused : null } : {}),
      ...(here && windows === "close" ? { pane: null } : {}),
    },
    into,
    closed: windows === "close" ? own : [],
  };
}
