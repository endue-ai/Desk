/**
 * Core key bindings and the commands that belong to the keymap itself: quit
 * (C-g: stop what is in progress) and the list of bindings. The person's own bindings
 * (`desk.keys.bindings`, set by a rebinding screen or init.yaml) are the last layer.
 */
import type { KeyBinding } from "@endue-ai/bridge";
import { isBinding, PERSONAL_KEYS } from "../core/defaults";
import { DEFAULT_KEYS } from "../core/keys";
import { formatCombo } from "../input";
import { Keymap } from "../keymap";
import type { PolicySet } from "../policy";
import { type DeskContext, disposer, type Installed } from "./context";

/** The setting that holds the person's layer of the keymap. */
export { PERSONAL_KEYS } from "../core/defaults";

export interface KeysPolicy extends Installed {
  keymap: Keymap;
  /** Core defaults and plugin bindings, in layer order, without the person's. */
  contributed(): PolicySet["keys"];
  /** The person's layer as it is now. */
  personal(): KeyBinding[];
  /** Run when the person quits (Escape by default): hide the palette, dismiss a notice. */
  onQuit(handler: () => void): () => void;
}

export function installKeys(ctx: DeskContext, language: "ko" | "en" = "en"): KeysPolicy {
  const { hub, shortcuts } = ctx;
  const { commands } = hub;
  const keymap = new Keymap(shortcuts, commands);
  const quitters = new Set<() => void>();
  const offs = disposer();

  const personal = (): KeyBinding[] => {
    const value = hub.settings.get<unknown>(PERSONAL_KEYS, []);
    return Array.isArray(value) ? value.filter(isBinding) : [];
  };
  const apply = () =>
    keymap.apply([
      ...DEFAULT_KEYS,
      ...hub.policy.keys,
      ...personal().map((binding) => ({ ...binding, owner: "person" })),
    ]);
  offs.add(hub.onPolicy(apply));
  offs.add(hub.settings.onChange((keys) => keys.includes(PERSONAL_KEYS) && apply()));
  offs.add(() => keymap.apply([]));
  offs.add(
    commands.define("desk.keys.quit", {
      title: language === "ko" ? "진행 중인 작업 닫기" : "Quit what is in progress",
      keywords: ["cancel", "escape", "keyboard-quit"],
      owner: "desk",
      run: () => {
        for (const quit of quitters) quit();
      },
    }),
  );
  offs.add(
    commands.define("desk.keys.list", {
      title: language === "ko" ? "단축키 목록 보기" : "List key bindings",
      keywords: ["keys", "shortcuts", "describe"],
      owner: "desk",
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
    contributed: () => [...DEFAULT_KEYS, ...hub.policy.keys],
    personal,
    onQuit: (handler) => {
      quitters.add(handler);
      return () => quitters.delete(handler);
    },
    dispose: offs.dispose,
  };
}
