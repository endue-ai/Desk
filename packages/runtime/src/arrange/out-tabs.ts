/**
 * Tabs of a window popped out into an OS window of its own (issue 235, ADR 0294). Such a window
 * shows one plugin's surface and no tab strip, so a new tab there is what a new window is in an
 * OS app: the plugin's next window (ADR 0212), popped out into an OS window of its own beside it.
 * Its one tab closes as the window does, asking about unsaved changes first.
 */
import { pluginOf } from "../instances";
import type { SurfacePlacement } from "../modes/types";
import { type Ctx, windowsOf } from "../shell/actions";
import type { DeskState } from "../shell/state";
import { closeWindow } from "../shell/windows";
import { outWindows, windowPlugins } from "../surface/placed";
import { tabsOf } from "../surface/tree";
import { POP_OUT } from "./out";
import { failed, sayOf } from "./target";

/** How long a new tab waits for its plugin's next window to be placed. */
export const OPENS_MS = 5000;

/** The window that shows plugin window `key`, on the canvas or out, and whether it is out. */
function showing(s: DeskState, key: string): { id: string; out: boolean } | undefined {
  const shows = (p: SurfacePlacement) => windowPlugins(s, p.id).includes(key);
  const out = outWindows(s).find(shows);
  if (out) return { id: out.id, out: true };
  const here = windowsOf(s).find(shows);
  return here && { id: here.id, out: false };
}

/** The window that shows `key` once the window manager has placed it. */
function placed(ctx: Pick<Ctx, "store">, key: string): Promise<{ id: string; out: boolean }> {
  const now = showing(ctx.store.get(), key);
  if (now) return Promise.resolve(now);
  return new Promise((resolve, reject) => {
    const late = setTimeout(() => {
      off();
      reject(failed(sayOf(ctx)("noTabs")));
    }, OPENS_MS);
    const off = ctx.store.watch(
      (s) => showing(s, key),
      (found) => {
        if (!found) return;
        clearTimeout(late);
        off();
        resolve(found);
      },
    );
  });
}

/**
 * A new tab of out window `p`: its plugin's next window, out in an OS window of its own (a plugin
 * whose windows open out does that itself). Answers that window, which is its own one tab.
 */
export async function newOutTab(
  ctx: Ctx,
  p: SurfacePlacement,
): Promise<{ window: string; tab: string; out: true }> {
  const [shown] = windowPlugins(ctx.store.get(), p.id);
  const another = ctx.runtime.plugins?.another;
  if (!shown || !another) throw failed(sayOf(ctx)("noTabs"));
  const key = another(pluginOf(shown));
  const opened = await placed(ctx, key);
  if (!opened.out) await ctx.runtime.commands.run(POP_OUT, { window: opened.id });
  const tab = tabsOf(
    outWindows(ctx.store.get()).find((w) => w.id === opened.id) ?? { ...p, id: opened.id },
  )[0];
  return { window: opened.id, tab: tab?.id ?? opened.id, out: true };
}

/** Close tab `tab` of out window `p`, its only one: the window closes, asking first. */
export async function closeOutTab(
  ctx: Ctx,
  p: SurfacePlacement,
  tab: unknown,
): Promise<{ window: string; tab: string; closed: boolean; windowClosed: boolean }> {
  if (typeof tab !== "string" || !tabsOf(p).some((t) => t.id === tab)) {
    throw failed(sayOf(ctx)("noTab"));
  }
  await closeWindow(ctx, p.id);
  const left = outWindows(ctx.store.get()).some((w) => w.id === p.id);
  return { window: p.id, tab, closed: !left, windowClosed: !left };
}
