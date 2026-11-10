/**
 * Arranging windows (ADR 0116), mounted by the shell's windows (`surface/Surface.ts`): the
 * desk.windows.* commands and the right-edge strip that runs them. The window manager tiles,
 * cascades and puts an arrangement back (crates/desk-wm, #83). The spread is not drawn on the
 * compositor yet (#54): its model is desk-wm's (`spread/`), and its command, key and button come
 * back with it.
 */
import { CommandError } from "../commands";
import type { ShellCtx } from "../shell/context";
import { defineArrangeCommands } from "./commands";
import { mountStrip } from "./strip";

export function mountArrange(root: HTMLElement, ctx: ShellCtx): () => void {
  const run = (command: string) => {
    void ctx.runtime.commands.run(command).catch((error: unknown) => {
      // A failed arrangement says why in its notice; nothing else to do here.
      if (!(error instanceof CommandError)) throw error;
    });
  };
  const offs = [defineArrangeCommands(ctx), mountStrip(root, ctx, run)];
  return () => {
    for (const off of offs) off();
  };
}
