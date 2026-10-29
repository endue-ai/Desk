/**
 * desk.keys: bind the keymap in force, and the commands that belong to the keymap itself: quit
 * (C-g: stop what is in progress) and the list of bindings.
 */
import { formatCombo } from "../input";
import { Keymap } from "../keymap";
import { type DeskContext, disposer, type Installed } from "./context";

export interface KeysPolicy extends Installed {
  keymap: Keymap;
  /** Run when the person quits (Escape by default): hide the palette, dismiss a notice. */
  onQuit(handler: () => void): () => void;
}

export function installKeys(ctx: DeskContext): KeysPolicy {
  const { hub, shortcuts } = ctx;
  const { commands } = hub;
  const keymap = new Keymap(shortcuts, commands);
  const quitters = new Set<() => void>();
  const offs = disposer();

  offs.add(hub.onPolicy((policy) => keymap.apply(policy.keys)));
  offs.add(() => keymap.apply([]));
  offs.add(
    commands.define("desk.keys.quit", {
      title: "Quit what is in progress",
      keywords: ["cancel", "escape", "keyboard-quit"],
      owner: "desk.keys",
      run: () => {
        for (const quit of quitters) quit();
      },
    }),
  );
  offs.add(
    commands.define("desk.keys.list", {
      title: "List key bindings",
      keywords: ["keys", "shortcuts", "describe"],
      owner: "desk.keys",
      run: () =>
        keymap.bindings().map((binding) => ({
          key: formatCombo(binding.combo, shortcuts.platform),
          combo: binding.combo,
          command: binding.command,
          owner: binding.owner,
        })),
    }),
  );

  return {
    keymap,
    onQuit: (handler) => {
      quitters.add(handler);
      return () => quitters.delete(handler);
    },
    dispose: offs.dispose,
  };
}
