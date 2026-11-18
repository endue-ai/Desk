/**
 * Arranging windows (ADR 0116), mounted by the shell's windows (`surface/Surface.ts`): the
 * desk.windows.* commands. The right rail's Arrange button runs them (`menu.ts`, `shell/Rail.ts`,
 * ADR 0220); desk.windows.put-away puts a window in the drawer (`away.ts`), which no title bar's
 * tool does (issue 280); desk.windows.find is the palette's Windows group (`find.ts`, #304). The window manager tiles, cascades and puts an arrangement back (crates/desk-wm,
 * #83); the compositor draws the spread (#54, ADR 0161). Agents, Eris first, move and resize a
 * window in pixels, fill or snap it (`frame.ts`) and do the rest its title bar, the drawer and the
 * desktops do with it (`control.ts`, ADR 0269).
 */
import type { ShellCtx } from "../shell/context";
import { defineAwayCommand } from "./away";
import { defineArrangeCommands } from "./commands";
import { defineControlCommands } from "./control";
import { defineFindWindows } from "./find";
import { defineFrameCommands } from "./frame";
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
  const offs = [
    defineArrangeCommands(ctx, keys),
    defineOutCommands(ctx),
    defineAwayCommand(ctx),
    defineFindWindows(ctx),
    defineFrameCommands(ctx),
    defineControlCommands(ctx),
  ];
  return () => {
    for (const off of offs) off();
  };
}
