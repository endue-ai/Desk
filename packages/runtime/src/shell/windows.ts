/**
 * Surfaces as windows: ⌘N opens a new one with a launcher, and any pane splits right or down,
 * closes, or takes another view. Every change is a session edit of the current desktop's layout.
 */
import type { PaneSplit, SurfacePlacement } from "../modes/types";
import { FREE } from "../surface/geometry";
import { halves } from "../surface/snap";
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
  defaultPlacement,
  edit,
  ensurePlaced,
  layoutOf,
  openSurface,
  windowsOf,
} from "./actions";

const SIZE = { w: 480, h: 320 };

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

/** Fill the free area, keeping the place to come back to; a second call comes back. */
export function toggleMaximize(ctx: Ctx, id: string): void {
  update(ctx, id, (p) => {
    const { restore, ...rest } = p;
    if (restore) return { ...rest, ...restore };
    return { ...rest, restore: { x: p.x, y: p.y, w: p.w, h: p.h }, ...FREE };
  });
}

/** Snap a window to a half of the free area, or fill it; a snapped window has nothing to restore. */
export function snapTo(ctx: Ctx, id: string, where: "left" | "right" | "full"): void {
  const rect = where === "full" ? FREE : halves(FREE)[where];
  update(ctx, id, (p) => {
    const { restore: _restore, ...rest } = p;
    return { ...rest, ...rect };
  });
}

/** The focused window, for the palette's window commands; nothing happens with none. */
export function focusedWindow(ctx: Ctx): string | undefined {
  return focusedPlacement(ctx)?.id;
}

/** A new surface with one launcher pane, cascading from the middle of the desk. */
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
  openSurface(ctx, id, placement);
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

/** Close a pane (the focused one unless named); the last pane closes its surface. */
export function closePane(ctx: Ctx, surface?: string, pane?: string): void {
  const p = surface
    ? windowsOf(ctx.store.get()).find((q) => q.id === surface)
    : focusedPlacement(ctx);
  if (!p) return;
  const tree = panesOf(p);
  const target = pane ?? ctx.store.get().pane ?? leaves(tree)[0]?.id ?? "p1";
  const next = close(tree, target);
  if (!next) {
    closeSurface(ctx, p.id);
    ctx.store.set({ focused: null, pane: null });
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
  openSurface(ctx, view, defaultPlacement(view));
  focusPane(ctx, view);
}
