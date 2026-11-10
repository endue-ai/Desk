/**
 * The window manager's part of the shell's store as crates/desk-wm reads it (its `Desk`, in its
 * JSON), for compositor mode (#81, ADR 0151): the CEF shell mirrors it into desk-wm, which places
 * every window the compositor draws, while the runtime keeps the state (ADR 0156). The profile in force
 * comes layered (`layoutOf`), so desk-wm reads each desktop's layout as this desk draws it, and the
 * session is in it already; the titles of the shell's own views come with it.
 */
import { EMPTY_DESKTOP } from "../modes/model";
import type { DesktopLayout } from "../modes/types";
import { leaves, panesOf } from "../surface/tree";
import { desktopId, desktopsOf, layoutOf, windowsOf } from "./actions";
import { t } from "./copy";
import type { DeskState, Store } from "./state";
import { surfaceTitle, type Titled } from "./titles";

/** desk-wm's `Desk`. */
export interface WmDesk {
  saved: {
    list: { id: string; name: string }[];
    desktop: DesktopLayout;
    desktops: Record<string, DesktopLayout>;
  };
  desktop: string;
  session: Record<string, DesktopLayout>;
  desktops: null;
  pan: DeskState["pan"];
  focusBy: DeskState["focusBy"];
  adopted: DeskState["adopted"];
  drawer: DeskState["drawer"];
  focused: string | null;
  pane: string | null;
}

/** The store `s` as desk-wm's `Desk`: every desktop's layout as drawn, nothing left to layer. */
export function wmDesk(s: DeskState): WmDesk {
  const list = desktopsOf(s).map((d) => ({ id: d.id, name: d.name }));
  return {
    saved: {
      list,
      desktop: EMPTY_DESKTOP,
      desktops: Object.fromEntries(list.map((d) => [d.id, layoutOf(s, d.id)])),
    },
    desktop: desktopId(s),
    session: {},
    desktops: null,
    pan: s.pan,
    focusBy: s.focusBy,
    adopted: s.adopted,
    // desk-wm keeps the drawer's times in whole milliseconds; the wall clock here has fractions.
    drawer: s.drawer.map((d) => ({ ...d, at: Math.round(d.at) })),
    focused: s.focused,
    pane: s.pane,
  };
}

/**
 * The titles of the shell's own views the windows of the desktop in front show, by view, in the
 * desk's language (`tr`: the shell's copy).
 */
export function wmTitles(
  store: Store,
  tr: NonNullable<Titled["tr"]> = (key, vars) => t(store.get().lang, key, vars),
): Record<string, string> {
  const ctx: Titled = { store, tr };
  const titles: Record<string, string> = {};
  for (const p of windowsOf(store.get())) {
    for (const leaf of leaves(panesOf(p))) {
      if (!leaf.view.startsWith("plugin:")) titles[leaf.view] = surfaceTitle(ctx, leaf.view);
    }
  }
  return titles;
}
