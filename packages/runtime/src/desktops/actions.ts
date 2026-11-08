/**
 * What the shell does with desktops (ADR 0117), over the store and the runtime: switch (bringing back
 * the window each one had in use), add, rename, remove, reorder, move a window across, and undo the
 * last move or removal.
 */
import type { DesktopId, DesktopRef, SurfacePlacement } from "../modes/types";
import { desktopId, desktopsOf, layoutOf, setDesktop, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import type { DeskState, Store } from "../shell/state";
import { focusPane } from "../shell/windows";
import { leaves, panesOf } from "../surface/tree";
import { resolveView } from "../surface/views";
import { type DesktopsCopyKey, dt } from "./copy";
import { idAt, MAX_DESKTOPS, positionOf, stepFrom } from "./model";
import { type Moved, movedBack, moveWindow } from "./move";
import { addDesktop, removeDesktop, renameDesktop, reorderDesktop } from "./ops";

const UNDO = "desk.shell.desktop-undo";
const DEPTH = 20;

type Undo =
  | { kind: "move"; moved: Moved }
  | { kind: "remove"; name: string; before: Kept; after: string };
type Kept = Pick<DeskState, "session" | "desktops" | "pan" | "focusBy" | "desktop">;

const stacks = new WeakMap<Store, Undo[]>();
const stackOf = (ctx: ShellCtx): Undo[] => {
  const stack = stacks.get(ctx.store) ?? [];
  stacks.set(ctx.store, stack);
  return stack;
};
const push = (ctx: ShellCtx, undo: Undo) => {
  const stack = stackOf(ctx);
  stack.push(undo);
  if (stack.length > DEPTH) stack.shift();
};
const kept = (s: DeskState): Kept => ({
  session: s.session,
  desktops: s.desktops,
  pan: s.pan,
  focusBy: s.focusBy,
  desktop: desktopId(s),
});

export const tx = (ctx: ShellCtx, key: DesktopsCopyKey, vars?: Record<string, string | number>) =>
  dt(ctx.store.get().lang, key, vars);
/** A notice in the status line; `undo` gives it an Undo button. */
export const say = (
  ctx: ShellCtx,
  title: string,
  level: "info" | "warning" = "info",
  undo = false,
) =>
  ctx.runtime?.notify?.({
    caller: "desk",
    title,
    level,
    ...(undo ? { actions: [{ label: tx(ctx, "undo"), command: UNDO }] } : {}),
  });

export const nameOf = (s: DeskState, id: DesktopId): string =>
  desktopsOf(s).find((d) => d.id === id)?.name ?? id;

/** Bring a desktop to the front, with the window it had in use when the person left it. */
export function switchTo(ctx: ShellCtx, desktop: DesktopRef): void {
  const before = ctx.store.get();
  const to = idAt(desktopsOf(before), desktop);
  if (!to) return;
  const here = desktopId(before);
  setDesktop(ctx, to);
  if (to === here) return;
  const s = ctx.store.get();
  const back = s.focusBy[to];
  if (back && windowsOf(s, to).some((p) => p.id === back.window))
    focusPane(ctx, back.window, back.pane ?? undefined);
}

/** The next desktop (`step` 1) or the one before (-1), round the list. */
export function step(ctx: ShellCtx, by: number): void {
  const s = ctx.store.get();
  switchTo(ctx, stepFrom(desktopsOf(s), desktopId(s), by));
}

/** A new desktop at the end, in front unless `go` is false; undefined (and a warning) at the cap. */
export function newDesktop(ctx: ShellCtx, name?: string, go = true): DesktopId | undefined {
  const next = addDesktop(ctx.store.get(), name);
  if (!next) {
    say(ctx, tx(ctx, "full", { n: MAX_DESKTOPS }), "warning");
    return undefined;
  }
  ctx.store.set(next.patch);
  if (go) switchTo(ctx, next.id);
  return next.id;
}

/** An empty desktop: the first one besides this, else a new one. */
export function emptyDesktop(s: DeskState): DesktopId | undefined {
  const here = desktopId(s);
  return desktopsOf(s).find((d) => d.id !== here && layoutOf(s, d.id).surfaces.length === 0)?.id;
}

export function rename(ctx: ShellCtx, desktop: DesktopRef, name: string): void {
  ctx.store.set((s) => renameDesktop(s, desktop, name));
}

/** Move a desktop to position `to` (from 1), or by `by` places from where it is. */
export function reorder(ctx: ShellCtx, desktop: DesktopRef, to: { at?: number; by?: number }) {
  ctx.store.set((s) => {
    const id = desktopId(s, desktop);
    const at = to.at ?? positionOf(desktopsOf(s), id) + (to.by ?? 0);
    return reorderDesktop(s, id, at);
  });
}

/** The plugins a window shows: closing it unmounts them for the session, as closing a window does. */
function pluginsOf(s: DeskState, windows: SurfacePlacement[]): string[] {
  return [
    ...new Set(
      windows.flatMap((p) =>
        leaves(panesOf(p))
          .map((leaf) => resolveView(s, p, leaf.view))
          .filter((view) => view.startsWith("plugin:"))
          .map((view) => view.slice("plugin:".length)),
      ),
    ),
  ];
}

/** Remove a desktop, its windows moved to its neighbour or closed. */
export function remove(ctx: ShellCtx, desktop: DesktopRef, windows: "move" | "close"): boolean {
  const s = ctx.store.get();
  const removal = removeDesktop(s, desktop, windows);
  if (!removal) return false;
  const name = nameOf(s, desktopId(s, desktop));
  const plugins = pluginsOf(s, removal.closed);
  ctx.store.set({ ...removal.patch, popover: null });
  for (const plugin of plugins) ctx.runtime?.plugins?.unmount(plugin);
  // Closed windows' plugins are gone for the session: only a move comes back whole.
  if (windows === "move") {
    push(ctx, {
      kind: "remove",
      name,
      before: kept(s),
      after: JSON.stringify(kept(ctx.store.get())),
    });
  }
  say(ctx, tx(ctx, "removed", { name }), "info", windows === "move");
  return true;
}

/** Move a window to another desktop; `before` is where it was before a drag that ended there. */
export function moveWindowTo(
  ctx: ShellCtx,
  window: string,
  desktop: DesktopRef,
  before?: SurfacePlacement,
): boolean {
  const s = ctx.store.get();
  const result = moveWindow(s, window, desktop, before);
  if (!result) return false;
  ctx.store.set(result.patch);
  push(ctx, { kind: "move", moved: result.moved });
  return true;
}

/** Move the window in use to a new desktop. */
export function moveToNew(ctx: ShellCtx, window: string, before?: SurfacePlacement): boolean {
  const id = newDesktop(ctx, undefined, false);
  return id !== undefined && moveWindowTo(ctx, window, id, before);
}

/** Take the last move or removal back. */
export function undo(ctx: ShellCtx): boolean {
  const last = stackOf(ctx).pop();
  const s = ctx.store.get();
  if (last?.kind === "move") {
    const patch = movedBack(s, last.moved);
    if (patch) ctx.store.set(patch);
    return patch !== undefined;
  }
  if (last?.kind === "remove" && JSON.stringify(kept(s)) === last.after) {
    ctx.store.set({ ...last.before, focused: null, pane: null });
    return true;
  }
  say(ctx, tx(ctx, "nothingToUndo"));
  return false;
}
