/**
 * Surfaces as windows: ⌘N opens a new one with a launcher, and any pane splits right or down,
 * closes, or takes another view. Every change is a session edit of the current desktop's layout.
 */
import type { PaneSplit, SurfacePlacement } from "../modes/types";
import { appSize, isFloating, screenRect, storedRect } from "../surface/coordinates";
import { clampRect, REF, screenArea } from "../surface/geometry";
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
 * The whole app, or a half of it, in a window's own coordinates. A floating window keeps filling it
 * after the app is resized; a normal window takes the part of the canvas in sight and stays there on
 * the canvas.
 */
function filled(ctx: Ctx, p: SurfacePlacement, fill: Fill): Partial<SurfacePlacement> {
  if (isFloating(p)) return { ...fillRect(fill, screenArea(REF.width, REF.height)), fill };
  const { vw, vh } = appSize();
  const pan = panOf(ctx.store.get());
  return { ...storedRect(fillRect(fill, screenArea(vw, vh)), false, pan, vw, vh), fill };
}

const rectOf = (p: SurfacePlacement) => ({ x: p.x, y: p.y, w: p.w, h: p.h });

/** Fill the whole app, keeping the place to come back to; a second call comes back. */
export function toggleMaximize(ctx: Ctx, id: string): void {
  update(ctx, id, (p) => {
    const { restore, fill, ...rest } = p;
    // Filled (one saved before fills has a restore but no fill): come back.
    if (restore && (fill === "full" || fill === undefined)) return { ...rest, ...restore };
    return { ...rest, restore: restore ?? rectOf(p), ...filled(ctx, p, "full") };
  });
}

/**
 * Snap a window to a half of the app or fill it. Filling keeps the place to come back to, as the
 * title bar's double-click does; a half has nothing to restore.
 */
export function snapTo(ctx: Ctx, id: string, where: Fill): void {
  update(ctx, id, (p) => {
    const { restore, fill: _fill, ...rest } = p;
    const back = where === "full" ? (restore ?? rectOf(p)) : undefined;
    return { ...rest, ...filled(ctx, p, where), ...(back ? { restore: back } : {}) };
  });
}

/** The focused window, for the palette's window commands; nothing happens with none. */
export function focusedWindow(ctx: Ctx): string | undefined {
  return focusedPlacement(ctx)?.id;
}

/** A new surface with one launcher pane, cascading from the middle of what is in sight. */
export function newWindow(ctx: Ctx): string {
  const s = ctx.store.get();
  const taken = new Set([
    ...windowsOf(s).map((p) => p.id),
    ...s.drawer.flatMap((d) => (d.placement ? [d.placement.id] : [])),
  ]);
  let n = 1;
  while (taken.has(`window-${n}`)) n++;
  const id = `window-${n}`;
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
