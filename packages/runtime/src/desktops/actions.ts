/**
 * What the shell does with desktops (ADR 0117): switch (bringing back the window each one had in
 * use), add, rename, remove, reorder, move a window across, and undo the last move or removal. Each
 * is an edit the window manager makes (crates/desk-wm, #83), which keeps the undo too; what stays
 * here is the runtime's side: the notices, and unmounting the plugins a removal closed.
 */
import type { DesktopId, DesktopRef, SurfacePlacement } from "../modes/types";
import { desktopsOf, edit } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import type { DeskState } from "../shell/state";
import { focusPane } from "../shell/windows";
import { MAX_DESKTOPS } from "../wm/view";
import { type DesktopsCopyKey, dt } from "./copy";

const UNDO = "desk.shell.desktop-undo";

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

/** The runtime's surfaces follow the window the desktop brought back. */
async function arrived(ctx: ShellCtx): Promise<void> {
  const s = ctx.store.get();
  if (s.focused) await focusPane(ctx, s.focused, s.pane ?? undefined);
}

/** Bring a desktop to the front, with the window it had in use when the person left it. */
export async function switchTo(ctx: ShellCtx, desktop: DesktopRef): Promise<void> {
  await edit(ctx, { op: "switch-to", desktop });
  await arrived(ctx);
}

/** The next desktop (`step` 1) or the one before (-1), round the list. */
export async function step(ctx: ShellCtx, by: number): Promise<void> {
  await edit(ctx, { op: "step-desktop", by });
  await arrived(ctx);
}

/** A new desktop at the end, in front unless `go` is false; undefined (and a warning) at the cap. */
export async function newDesktop(
  ctx: ShellCtx,
  name?: string,
  go = true,
): Promise<DesktopId | undefined> {
  const [id] = await edit(ctx, { op: "add-desktop", ...(name === undefined ? {} : { name }), go });
  if (typeof id !== "string") {
    say(ctx, tx(ctx, "full", { n: MAX_DESKTOPS }), "warning");
    return undefined;
  }
  return id;
}

/** An empty desktop: the first one besides this, else none. */
export function emptyDesktop(s: DeskState): DesktopId | undefined {
  return desktopsOf(s).find(
    (d) => d.id !== s.wm.here && (s.wm.layouts[d.id]?.surfaces.length ?? 0) === 0,
  )?.id;
}

export function rename(ctx: ShellCtx, desktop: DesktopRef, name: string): Promise<unknown[]> {
  return edit(ctx, { op: "rename-desktop", desktop, name });
}

/** Move a desktop to position `to` (from 1), or by `by` places from where it is. */
export function reorder(
  ctx: ShellCtx,
  desktop: DesktopRef,
  to: { at?: number; by?: number },
): Promise<unknown[]> {
  return edit(ctx, { op: "reorder-desktop", desktop, ...to });
}

/** Remove a desktop, its windows moved to its neighbour or closed. */
export async function remove(
  ctx: ShellCtx,
  desktop: DesktopRef,
  windows: "move" | "close",
): Promise<boolean> {
  ctx.store.set({ popover: null });
  const [removal] = await edit(ctx, { op: "remove-desktop", desktop, windows });
  if (!removal || typeof removal !== "object") return false;
  const { name, closed } = removal as { name: string; closed: string[] };
  // Closed windows' plugins are gone for the session: only a move comes back whole.
  for (const plugin of closed) ctx.runtime?.plugins?.unmount(plugin);
  say(ctx, tx(ctx, "removed", { name }), "info", windows === "move");
  return true;
}

/** Move a window to another desktop; `before` is where it was before a drag that ended there. */
export async function moveWindowTo(
  ctx: ShellCtx,
  window: string,
  desktop: DesktopRef,
  before?: SurfacePlacement,
): Promise<boolean> {
  const [moved] = await edit(ctx, {
    op: "move-to-desktop",
    window,
    desktop,
    ...(before ? { before } : {}),
  });
  return moved === true;
}

/** Move the window in use to a new desktop. */
export async function moveToNew(
  ctx: ShellCtx,
  window: string,
  before?: SurfacePlacement,
): Promise<boolean> {
  const [moved] = await edit(ctx, { op: "move-to-new", window, ...(before ? { before } : {}) });
  if (moved !== true && desktopsOf(ctx.store.get()).length >= MAX_DESKTOPS) {
    say(ctx, tx(ctx, "full", { n: MAX_DESKTOPS }), "warning");
  }
  return moved === true;
}

/** Take the last move or removal back. */
export async function undo(ctx: ShellCtx): Promise<boolean> {
  const [undone] = await edit(ctx, { op: "undo-desktop" });
  if (undone !== true) say(ctx, tx(ctx, "nothingToUndo"));
  return undone === true;
}
