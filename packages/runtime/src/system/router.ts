/**
 * The one keyboard entry point: a key press is looked up in the keymap and runs its command.
 * Plain keys are left to text fields; chords (⌘, Ctrl or Alt) and Escape work everywhere.
 */
import { comboOf } from "../input";
import type { ShellCtx } from "../shell/context";
import { listen } from "../shell/dom";
import { runCommand } from "./commands";
import { isChord } from "./keys";

const MODIFIERS = new Set(["Meta", "Control", "Alt", "Shift", "OS"]);

function typingIn(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function mountKeyRouter(ctx: ShellCtx): () => void {
  return listen(
    window,
    "keydown",
    (e) => {
      const k = e as KeyboardEvent;
      if (ctx.keys.recording || k.isComposing || MODIFIERS.has(k.key)) return;
      const combo = comboOf(k);
      const id = ctx.keys.commandFor(combo);
      if (!id) return;
      if (typingIn(k.target) && !isChord(combo) && combo !== "Escape") return;
      if (runCommand(ctx, id) && combo !== "Escape") k.preventDefault();
    },
    { capture: true },
  );
}
