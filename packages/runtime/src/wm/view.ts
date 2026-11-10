/**
 * Reading what the window manager published (#83): the view before the first desk is in (the four
 * desktops a desk starts with, no window), a desktop by id or position, and taking a published
 * desk into the shell's store whole. Nothing here works a window out: desk-wm did.
 */
import { defaultDesktops } from "../desktops/model";
import { EMPTY_DESKTOP } from "../modes/model";
import type { DesktopId, DesktopLayout } from "../modes/types";
import type { DeskState, Store } from "../shell/state";
import type { Published, Rect, WmView } from "./types";

export { idAt, MAX_DESKTOPS, positionOf } from "../desktops/model";

/** What the runtime reads before the window manager published anything. */
export function emptyView(): WmView {
  return {
    desktops: defaultDesktops(),
    here: "1",
    windows: {},
    layouts: {},
    dirty: false,
    focusedPlugin: null,
    moved: null,
    restorable: false,
    screen: { w: 1440, h: 900 },
    front: [],
    rects: {},
    covered: [],
    ids: [],
  };
}

/** A desktop's layout as drawn; the empty one before the window manager said. */
export const layoutIn = (view: WmView, id: DesktopId): DesktopLayout =>
  view.layouts[id] ?? EMPTY_DESKTOP;

/**
 * Where window `id` of desktop `desktop` (the one in front when none) is on screen when that desktop
 * is in front, as the window manager placed it.
 */
export function rectIn(view: WmView, id: string, desktop: DesktopId = view.here): Rect | undefined {
  return view.rects[desktop]?.[id];
}

/** The store's part a published desk makes: the window manager's state and what is read of it. */
export function deskPatch(published: Published): Partial<DeskState> {
  const { desk, view } = published;
  return {
    rev: published.rev,
    wm: view,
    desktop: view.here,
    session: desk.session,
    desktops: desk.desktops,
    pan: desk.pan,
    focusBy: desk.focusBy,
    adopted: desk.adopted,
    drawer: desk.drawer,
    focused: desk.focused,
    pane: desk.pane,
  };
}

/** Take a desk the window manager published, unless an older one arriving late. */
export function takeDesk(store: Store, published: Published): void {
  if (published.rev <= store.get().rev) return;
  store.set(deskPatch(published));
}
