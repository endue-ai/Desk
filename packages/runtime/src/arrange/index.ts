/**
 * Arranging windows (ADR 0116), mounted by the shell's windows (`surface/Surface.ts`): the
 * desk.windows.* commands. The right rail's Arrange button runs them (`menu.ts`, `shell/Rail.ts`,
 * ADR 0220). The window manager tiles, cascades and puts an arrangement back (crates/desk-wm,
 * #83); the compositor draws the spread (#54, ADR 0161).
 */
import type { ShellCtx } from "../shell/context";
import { defineArrangeCommands } from "./commands";
import { defineOutCommands } from "./out";

export function mountArrange(root: HTMLElement, ctx: ShellCtx): () => void {
  // A window of the shell's own views holds the keyboard itself once it is focused, in this page or
  // in its own (ADR 0201, `window-docs.ts`).
  const keys = (window: string) => {
    const shell = root.closest<HTMLElement>(".shell") ?? root;
    const el =
      ctx.pages?.section(window, shell) ??
      [...shell.querySelectorAll<HTMLElement>(".surface[data-surface]")].find(
        (e) => e.dataset.surface === window,
      );
    el?.focus({ preventScroll: true });
  };
  const offs = [defineArrangeCommands(ctx, keys), defineOutCommands(ctx)];
  return () => {
    for (const off of offs) off();
  };
}
