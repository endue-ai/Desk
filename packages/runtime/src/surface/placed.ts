/**
 * The plugins the windows of the desktop in front place wake (ADR 0070): a plugin that started asleep
 * has no surface until its first use, and a window showing nothing but plugins the runtime does not
 * hold is not drawn (`shell/actions.ts`). A profile's window named after its surface shows the
 * plugin it names (`surface/views.ts`), so its plugin is placed too.
 */
import { layoutOf, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import type { DeskState } from "../shell/state";
import { leaves, panesOf } from "./tree";

const VIEW = "plugin:";

/**
 * The plugins window `id` of the desktop in front shows, each once: what closing it unmounts
 * (desk-wm's `plugins_of`). A pane named after its window shows the window's plugin (`resolveView`
 * in `views.ts`); one the runtime does not hold has no buffers, so it may be named either way.
 */
export function windowPlugins(s: DeskState, id: string): string[] {
  const p = windowsOf(s).find((w) => w.id === id);
  if (!p) return [];
  const ids = leaves(panesOf(p)).flatMap(({ view }) => {
    if (view === p.id && p.plugin) return [p.plugin];
    return view.startsWith(VIEW) ? [view.slice(VIEW.length)] : [];
  });
  return [...new Set(ids)];
}

/** The plugins the layout of the desktop in front places, each once. */
export function placedPlugins(s: DeskState): string[] {
  const ids = layoutOf(s).surfaces.flatMap((p) => [
    p.plugin,
    ...leaves(panesOf(p))
      .filter((leaf) => leaf.view.startsWith(VIEW))
      .map((leaf) => leaf.view.slice(VIEW.length)),
  ]);
  return [...new Set(ids)];
}

/** Wake what the windows place as the layout changes; `now` wakes what they place already. */
export function wakePlaced(ctx: Pick<ShellCtx, "store" | "runtime">): {
  now(): void;
  off(): void;
} {
  const wake = (ids: string[]) => {
    for (const id of ids) ctx.runtime.plugins?.wake(id);
  };
  // After the change that placed them: opening a surface changes the store again (it is adopted).
  const off = ctx.store.watch(placedPlugins, (ids) => queueMicrotask(() => wake(ids)));
  return { now: () => wake(placedPlugins(ctx.store.get())), off };
}
