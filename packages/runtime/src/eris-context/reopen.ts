/**
 * desk.windows.reopen (ADR 0124): a window from the log comes back where it was, on the desktop it
 * was on (the one in front when that desktop is gone), with its place, size and panes, and the
 * plugins it showed are started again. It is the window in use. A plugin that cannot start takes
 * the window back out and leaves it in the log. When another window took its id meanwhile, a window
 * whose panes name their views comes back under a new id; one its id names (a plugin's own window)
 * brings that window up instead.
 */
import type { DesktopId, SurfacePlacement } from "../modes/types";
import { desktopId, desktopsOf, editAt, raise, setDesktop, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import type { DeskState } from "../shell/state";
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

/** Every window id on the desk: on any desktop or in the drawer. */
function taken(s: DeskState): Set<string> {
  return new Set([
    ...desktopsOf(s).flatMap((d) => windowsOf(s, d.id).map((p) => p.id)),
    ...s.drawer.flatMap((d) => (d.placement ? [d.placement.id] : [])),
  ]);
}

/** The placement under an id no window has, when its panes do not depend on its id. */
function renamed(p: SurfacePlacement, ids: Set<string>): SurfacePlacement | undefined {
  if (!p.panes || leaves(panesOf(p)).some((leaf) => leaf.view === p.id)) return undefined;
  let n = 1;
  while (ids.has(`window-${n}`)) n++;
  return { ...p, id: `window-${n}` };
}

/** Bring up the window that holds `id` now, wherever it is. */
function bringUp(ctx: ShellCtx, id: string): DesktopId {
  const s = ctx.store.get();
  const holder = desktopsOf(s).find((d) => windowsOf(s, d.id).some((p) => p.id === id));
  const drawn = s.drawer.find((d) => d.placement?.id === id);
  if (holder) {
    if (holder.id !== desktopId(s)) setDesktop(ctx, holder.id);
    focusPane(ctx, id);
  } else if (drawn) raise(ctx, drawn.id);
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
  const ids = taken(s);
  const placement = ids.has(entry.id) ? renamed(entry.placement, ids) : entry.placement;
  const { x, y, w, h } = entry.placement;
  log.forget(entry.id);
  if (!placement)
    return { id: entry.id, title: entry.title, desktop: bringUp(ctx, entry.id), x, y, w, h };
  const list = desktopsOf(s);
  const desktop = list.find((d) => d.id === entry.desktop)?.id ?? desktopId(s);
  if (desktop !== desktopId(s)) setDesktop(ctx, desktop);
  const place = (keep: boolean) =>
    editAt(ctx, desktop, (l) => ({
      ...l,
      surfaces: [
        ...l.surfaces.filter((p) => p.id !== placement.id),
        ...(keep ? [structuredClone(placement)] : []),
      ],
    }));
  place(true);
  try {
    for (const plugin of entry.plugins) {
      if (ctx.store.get().adopted.some((a) => a.id === plugin)) continue;
      await ctx.runtime.commands.run("desk.plugins.open", { plugin });
    }
  } catch (error) {
    place(false);
    log.put(entry);
    throw error;
  }
  focusPane(ctx, placement.id);
  return { id: placement.id, title: entry.title, desktop, x, y, w, h };
}
