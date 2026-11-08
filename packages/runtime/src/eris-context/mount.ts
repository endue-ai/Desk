/**
 * What Eris knows past the windows on screen (ADR 0124), mounted on a desk: the log of the windows
 * closed recently, kept in the shell's storage and started once the desk has (the plugins, the
 * profile and the saved session are in); the summary of what the person can do for every turn; and
 * their three agent commands. A saved layout that desk.shell.layouts puts back is no window closing.
 */

import { LAYOUTS } from "../modes/profiles";
import { movedOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { catalogue, sourceOf, summarise } from "./capabilities";
import { watchClosed } from "./closed";
import { defineContextCommands } from "./commands";
import { provide } from "./registry";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether the store is about to follow desk.shell.layouts: it changed ahead of the store (a session
 * put back, a revert), not after it (the shell keeping the person's own change there).
 */
function layoutsAhead(ctx: ShellCtx): { restoring(): boolean; off(): void } {
  let ahead = false;
  const settings = ctx.runtime.settings;
  if (!settings?.onChange) return { restoring: () => false, off: () => {} };
  const off = settings.onChange((keys) => {
    if (!keys.includes(LAYOUTS)) return;
    const s = ctx.store.get();
    if (!same(movedOf(ctx), { session: s.session, desktops: s.desktops })) ahead = true;
  });
  return {
    restoring() {
      const was = ahead;
      ahead = false;
      return was;
    },
    off,
  };
}

export function mountErisContext(ctx: ShellCtx): () => void {
  const { runtime } = ctx;
  const layouts = layoutsAhead(ctx);
  const log = watchClosed(ctx, {
    ...(ctx.bridge?.storage ? { storage: ctx.bridge.storage } : {}),
    ready: runtime.plugins?.ready ?? runtime.ready,
    restoring: layouts.restoring,
  });
  const unprovide = provide(ctx.store, {
    capabilities: () => summarise(catalogue(sourceOf(ctx))),
  });
  const offCommands = defineContextCommands(ctx, log);
  return () => {
    offCommands();
    unprovide();
    log.dispose();
    layouts.off();
  };
}
