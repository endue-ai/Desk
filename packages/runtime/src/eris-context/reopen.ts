/**
 * desk.windows.reopen (ADR 0124): a window from the log comes back where it was, on the desktop it
 * was on (the one in front when that desktop is gone), with its place, size and panes, and the
 * plugins it showed are started again. It is the window in use. A plugin that cannot start takes
 * the window back out and leaves it in the log. When another window took its id meanwhile, a window
 * whose panes name their views comes back under a new id; one its id names (a plugin's own window)
 * brings that window up instead.
 */
import type { DesktopId, SurfacePlacement } from "../modes/types";
import { desktopId, desktopsOf, edit, raise, setDesktop, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { freeWindowId } from "../shell/window-ids";
import { focusPane } from "../shell/windows";
import { leaves, panesOf } from "../surface/tree";
import type { ClosedLog } from "./closed";
import { ec } from "./copy";

export interface Reopened {
  id: string;
  title: string;
  desktop: DesktopId;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The placement under an id no window has, when its panes do not depend on its id. */
function renamed(p: SurfacePlacement, ids: Set<string>): SurfacePlacement | undefined {
  if (!p.panes || leaves(panesOf(p)).some((leaf) => leaf.view === p.id)) return undefined;
  return { ...p, id: freeWindowId(ids) };
}

/** Bring up the window that holds `id` now, wherever it is. */
async function bringUp(ctx: ShellCtx, id: string): Promise<DesktopId> {
  const s = ctx.store.get();
  const holder = desktopsOf(s).find((d) => windowsOf(s, d.id).some((p) => p.id === id));
  const drawn = s.drawer.find((d) => d.placement?.id === id);
  if (holder) {
    if (holder.id !== desktopId(s)) await setDesktop(ctx, holder.id);
    await focusPane(ctx, id);
  } else if (drawn) await raise(ctx, drawn.id);
  return desktopId(ctx.store.get());
}

/** Reopen the window `id` closed, or the last one closed when `id` is absent. */
export async function reopenWindow(ctx: ShellCtx, log: ClosedLog, id?: string): Promise<Reopened> {
  const lang = ctx.store.get().lang;
  const entries = log.list();
  const entry = id === undefined ? entries[0] : entries.find((e) => e.id === id);
  if (!entry)
    throw new Error(id === undefined ? ec(lang, "noneClosed") : ec(lang, "notClosed", { id }));
  const s = ctx.store.get();
  const ids = new Set(s.wm.ids);
  const placement = ids.has(entry.id) ? renamed(entry.placement, ids) : entry.placement;
  const { x, y, w, h } = entry.placement;
  log.forget(entry.id);
  if (!placement) {
    const desktop = await bringUp(ctx, entry.id);
    return { id: entry.id, title: entry.title, desktop, x, y, w, h };
  }
  const list = desktopsOf(s);
  const desktop = list.find((d) => d.id === entry.desktop)?.id ?? desktopId(s);
  if (desktop !== desktopId(s)) await setDesktop(ctx, desktop);
  await edit(ctx, { op: "place", desktop, placement: structuredClone(placement) });
  try {
    for (const plugin of entry.plugins) {
      if (ctx.store.get().adopted.some((a) => a.id === plugin)) continue;
      await ctx.runtime.commands.run("desk.plugins.open", { plugin });
    }
  } catch (error) {
    await edit(ctx, { op: "unplace", desktop, id: placement.id });
    log.put(entry);
    throw error;
  }
  await focusPane(ctx, placement.id);
  return { id: placement.id, title: entry.title, desktop, x, y, w, h };
}
