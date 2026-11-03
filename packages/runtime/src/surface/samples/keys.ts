/** Compatibility view for older saved panes; the editor itself belongs to the core. */
import { DEFAULT_KEYS } from "../../core/keys";
import { mountKeyboard } from "../../settings-ui/keyboard";
import type { ShellCtx } from "../../shell/context";
import type { Mounted } from "../views";

export function keysBody(ctx: ShellCtx): Mounted {
  const editor = mountKeyboard({
    settings: ctx.runtime.settings,
    commands: ctx.runtime.commands,
    contributed: () => [...DEFAULT_KEYS, ...ctx.runtime.policy().keys],
    keymap: ctx.runtime.keymap,
    platform: ctx.platform,
    language: ctx.store.get().lang,
  });
  editor.el.classList.add("desk-settings-embedded");
  return { el: editor.el, off: editor.dispose };
}
