/**
 * Surfaces as windows: ⌘N opens a new one with a launcher, and any pane splits right or down,
 * closes, or takes another view. Every change is a session edit of the current desktop's layout.
 */
import type { PaneSplit, SurfacePlacement } from "../modes/types";
import { appSize, isFloating, screenRect, storedRect } from "../surface/coordinates";
import { clampRect, REF, type Rect, screenArea } from "../surface/geometry";
import { type Fill, fillRect } from "../surface/snap";
import {
  close,
  findLeaf,
  LAUNCHER,
  leaves,
  panesOf,
  setRatio,
  setView,
  split,
} from "../surface/tree";
import { resolveView } from "../surface/views";
import {
  type Ctx,
  closeSurface,
  desktopsOf,
  edit,
  ensurePlaced,
  inView,
  layoutOf,
  openSurface,
  raise,
  setDesktop,
  windowsOf,
} from "./actions";
import { panOf } from "./Pan";
import { freeWindowId, windowIds } from "./window-ids";

const SIZE = { w: 480, h: 320 };

/** Reveal a plugin's existing pane before considering a new window or an empty launcher. */
export function showPlugin(ctx: Ctx, id: string): void {
  const paneIn = (p: SurfacePlacement) =>
    leaves(panesOf(p)).find(
      (leaf) => resolveView(ctx.store.get(), p, leaf.view) === `plugin:${id}`,
    );
  const shown = windowsOf(ctx.store.get()).find((p) => paneIn(p));
  if (shown) {
    focusPane(ctx, shown.id, paneIn(shown)?.id);
    return;
  }
  // A window on another desktop shows it (ADR 0117): the desk goes there.
  const s = ctx.store.get();
  const there = desktopsOf(s).find((d) => windowsOf(s, d.id).some((p) => paneIn(p)));
  const away = there && windowsOf(s, there.id).find((p) => paneIn(p));
  if (there && away) {
    setDesktop(ctx, there.id);
    focusPane(ctx, away.id, paneIn(away)?.id);
    return;
  }
  const item = ctx.store.get().drawer.find((d) => d.placement && paneIn(d.placement));
  if (item?.placement) {
    raise(ctx, item.id);
    focusPane(ctx, item.placement.id, paneIn(item.placement)?.id);
  } else openView(ctx, `plugin:${id}`);
}

function update(ctx: Ctx, id: string, change: (p: SurfacePlacement) => SurfacePlacement): void {
  ensurePlaced(ctx, id);
  edit(ctx, (l) => ({ ...l, surfaces: l.surfaces.map((p) => (p.id === id ? change(p) : p)) }));
}

/** Focus a surface and one of its panes (its first when none is named). */
export function focusPane(ctx: Ctx, surface: string, pane?: string): void {
  const s = ctx.store.get();
  const p = windowsOf(s).find((w) => w.id === surface);
  if (!p) return;
  const all = leaves(panesOf(p));
  const target = all.find((l) => l.id === pane) ?? all[0];
  const plugin = target ? resolveView(s, p, target.view) : "";
  if (plugin.startsWith("plugin:")) {
    // The pane shows a runtime surface: it is the one in use, for keys and buffers. One already in
    // use keeps the focus where it is (inside its frame, say).
    const id = plugin.slice("plugin:".length);
    if (ctx.runtime.shortcuts.focused !== id) ctx.runtime.focusSurface(id);
  } else if (ctx.runtime.shortcuts.focused) {
    // A pane of the shell's own in use: the runtime's surfaces give the focus up.
    ctx.runtime.focusSurface(null);
  }
  if (s.focused !== surface || s.pane !== (target?.id ?? null)) {
    ctx.store.set({ focused: surface, pane: target?.id ?? null });
  }
}

function focusedPlacement(ctx: Ctx): SurfacePlacement | undefined {
  const s = ctx.store.get();
  return windowsOf(s).find((p) => p.id === s.focused);
}

/** Switch coordinate systems while preserving the visible rectangle. */
export function toggleFloating(ctx: Ctx, id: string, size = appSize()): void {
  const pan = panOf(ctx.store.get());
  update(ctx, id, (p) => {
    const floating = !isFloating(p);
    const screen = screenRect(p, pan, size.vw, size.vh);
    const rect = floating ? clampRect(screen, size.vw, size.vh) : screen;
    return {
      ...p,
      ...storedRect(rect, floating, pan, size.vw, size.vh),
      floating,
      restore: undefined,
      fill: undefined,
    };
  });
}

/**
 * The whole app, or a half or quarter of it, in the reference frame (ADR 0132): the bars float above
 * a filled window as they do above every window, and its title keeps clear of the top ones
 * (`surface/clearance.ts`). A fill floats the window (ADR 0128): it stays in its part whatever the
 * pan, and keeps filling it after the app is resized.
 */
function filled(fill: Fill): Partial<SurfacePlacement> {
  return { ...fillRect(fill, screenArea(REF.width, REF.height)), floating: true, fill };
}

/** Where a fill puts a window on an app of `size`: what a drag's snap preview shows. */
export function snapRect(fill: Fill, size = appSize()): Rect {
  return fillRect(fill, screenArea(size.vw, size.vh));
}

type Restore = NonNullable<SurfacePlacement["restore"]>;

/** The place to come back to: where the window is now, and in which mode. */
const placeOf = (p: SurfacePlacement): Restore => ({
  x: p.x,
  y: p.y,
  w: p.w,
  h: p.h,
  floating: isFloating(p),
});

/**
 * The window out of its fill: back at `back` (its restore, unless a drag moved it), in the mode it
 * had before it filled. A restore saved before fills floated names no mode: the window keeps its own.
 */
export function unfilled(p: SurfacePlacement, back: Rect = p.restore ?? p): SurfacePlacement {
  const { restore: _restore, fill: _fill, floating: _floating, ...rest } = p;
  const floating = p.restore?.floating ?? isFloating(p);
  return { ...rest, x: back.x, y: back.y, w: back.w, h: back.h, ...(floating ? { floating } : {}) };
}

/**
 * The window filling `where`. Its own place and mode stay the one to come back to; filling the
 * whole area from a half or a quarter also keeps that part, which the next restore comes back to.
 */
function fillWith(p: SurfacePlacement, where: Fill): SurfacePlacement {
  const { fill: _part, ...own } = p.restore ?? placeOf(p);
  const part = where === "full" && p.fill && p.fill !== "full" ? p.fill : undefined;
  return { ...p, restore: part ? { ...own, fill: part } : own, ...filled(where) };
}

/**
 * Fill the whole app, keeping the place to come back to; a second call comes back: to the half or
 * quarter it filled from, or to its own place and mode.
 */
export function toggleMaximize(ctx: Ctx, id: string): void {
  update(ctx, id, (p) => {
    // Filled (one saved before fills has a restore but no fill): come back.
    if (p.restore && (p.fill === "full" || p.fill === undefined)) {
      return p.restore.fill ? fillWith(p, p.restore.fill) : unfilled(p);
    }
    return fillWith(p, "full");
  });
}

/**
 * Snap a window to a half or a quarter of the app, or fill it. Every fill keeps the place and
 * the mode to come back to: the title bar's double-click comes back from the whole area, and
 * dragging a snapped window out brings back its size and mode.
 */
export function snapTo(ctx: Ctx, id: string, where: Fill): void {
  update(ctx, id, (p) => fillWith(p, where));
}

/** The focused window, for the palette's window commands; nothing happens with none. */
export function focusedWindow(ctx: Ctx): string | undefined {
  return focusedPlacement(ctx)?.id;
}

/**
 * A new surface with one launcher pane, cascading from the middle of what is in sight. Its id is
 * the first `window-<n>` no window on any desktop or in the drawer has (issue 101).
 */
export function newWindow(ctx: Ctx): string {
  const s = ctx.store.get();
  const id = freeWindowId(windowIds(s));
  const k = layoutOf(s).surfaces.length % 6;
  const placement: SurfacePlacement = {
    id,
    plugin: "endue.window",
    x: 480 + 32 * k,
    y: 240 + 32 * k,
    ...SIZE,
    pinned: false,
    panes: { kind: "view", id: "p1", view: LAUNCHER },
  };
  openSurface(ctx, id, inView(s, placement));
  focusPane(ctx, id, "p1");
  return id;
}

/** Split the focused pane; the new pane opens the launcher and takes focus. */
export function splitPane(ctx: Ctx, dir: PaneSplit["dir"]): void {
  const p = focusedPlacement(ctx);
  if (!p) return;
  const tree = panesOf(p);
  const target = ctx.store.get().pane ?? leaves(tree)[0]?.id ?? "p1";
  const { node, added } = split(tree, target, dir);
  update(ctx, p.id, (q) => ({ ...q, panes: node }));
  focusPane(ctx, p.id, added);
}

/**
 * Close a window: it leaves the layout, and the plugins it shows unmount for the session (ADR 0040),
 * so none of them comes back as a window of its own or leaves an empty one behind.
 */
export function closeWindow(ctx: Ctx, id: string): void {
  const s = ctx.store.get();
  const p = windowsOf(s).find((w) => w.id === id);
  if (!p) return;
  const plugins = leaves(panesOf(p))
    .map((leaf) => resolveView(s, p, leaf.view))
    .filter((view) => view.startsWith("plugin:"))
    .map((view) => view.slice("plugin:".length));
  closeSurface(ctx, id);
  if (s.focused === id) ctx.store.set({ focused: null, pane: null });
  for (const plugin of new Set(plugins)) ctx.runtime.plugins?.unmount(plugin);
}

/** Close a pane (the focused one unless named); the last pane closes its window. */
export function closePane(ctx: Ctx, surface?: string, pane?: string): void {
  const p = surface
    ? windowsOf(ctx.store.get()).find((q) => q.id === surface)
    : focusedPlacement(ctx);
  if (!p) return;
  const tree = panesOf(p);
  const target = pane ?? ctx.store.get().pane ?? leaves(tree)[0]?.id ?? "p1";
  const next = close(tree, target);
  if (!next) {
    closeWindow(ctx, p.id);
    return;
  }
  update(ctx, p.id, (q) => ({ ...q, panes: next }));
  focusPane(ctx, p.id, leaves(next)[0]?.id);
}

export function showInPane(ctx: Ctx, surface: string, pane: string, view: string): void {
  const p = windowsOf(ctx.store.get()).find((s) => s.id === surface);
  if (!p) return;
  update(ctx, surface, (q) => ({ ...q, panes: setView(panesOf(q), pane, view) }));
  focusPane(ctx, surface, pane);
}

export function resizeSplit(ctx: Ctx, surface: string, splitId: string, ratio: number): void {
  update(ctx, surface, (q) => ({ ...q, panes: setRatio(panesOf(q), splitId, ratio) }));
}

/**
 * Bring a view up: into the focused launcher pane if there is one, else focus a pane that already
 * shows it, else open it as its own surface.
 */
export function openView(ctx: Ctx, view: string): void {
  const s = ctx.store.get();
  const surfaces = windowsOf(s);
  const focused = surfaces.find((p) => p.id === s.focused);
  const pane = focused && s.pane ? findLeaf(panesOf(focused), s.pane) : undefined;
  if (focused && pane?.view === LAUNCHER) {
    showInPane(ctx, focused.id, pane.id, view);
    return;
  }
  for (const p of surfaces) {
    const found = leaves(panesOf(p)).find((l) => l.view === view);
    if (found) {
      focusPane(ctx, p.id, found.id);
      return;
    }
  }
  if (surfaces.some((p) => p.id === view)) {
    // A surface named after this view now shows something else: give the view a new surface.
    showInPane(ctx, newWindow(ctx), "p1", view);
    return;
  }
  openSurface(ctx, view);
  focusPane(ctx, view);
}
