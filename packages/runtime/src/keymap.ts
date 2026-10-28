/**
 * The keymap (desk.keys, like global-map): every contributed binding in layer order, the later one
 * of a key winning and `"command": ""` taking a key away. Keys run commands; a key whose command is
 * off now does nothing and passes on.
 */
import type { Commands } from "./commands";
import { canonical, formatCombo, type Platform, type ShortcutRouter } from "./input";
import type { PolicySet } from "./policy";

export interface Binding {
  /** Canonical for the platform: Meta+K, Control+Shift+P, Escape. */
  combo: string;
  command: string;
  args?: unknown;
  owner: string;
}

/** The bindings in force for a platform, one per combo, in combo order. */
export function resolveKeymap(keys: PolicySet["keys"], platform: Platform): Binding[] {
  const map = new Map<string, Binding>();
  for (const key of keys) {
    const combo = canonical(platform === "mac" && key.mac ? key.mac : key.key, platform);
    if (key.command === "") map.delete(combo);
    else
      map.set(combo, {
        combo,
        command: key.command,
        owner: key.owner,
        ...("args" in key ? { args: key.args } : {}),
      });
  }
  return [...map.values()].sort((a, b) => (a.combo < b.combo ? -1 : a.combo > b.combo ? 1 : 0));
}

/** Keeps the shortcut router bound to the keymap in force. */
export class Keymap {
  readonly #router: ShortcutRouter;
  readonly #commands: Commands;
  #bindings: Binding[] = [];
  #unbind: Array<() => void> = [];

  constructor(router: ShortcutRouter, commands: Commands) {
    this.#router = router;
    this.#commands = commands;
  }

  apply(keys: PolicySet["keys"]): void {
    for (const off of this.#unbind) off();
    this.#bindings = resolveKeymap(keys, this.#router.platform);
    this.#unbind = this.#bindings.map((binding) =>
      this.#router.bind(binding.combo, () => {
        if (!this.#commands.has(binding.command)) return false;
        void this.#commands.run(binding.command, binding.args).catch(() => {});
      }),
    );
  }

  bindings(): Binding[] {
    return [...this.#bindings];
  }

  /** The keys that run `command`, as people read them on this platform. */
  keysFor(command: string): string[] {
    return this.#bindings
      .filter((binding) => binding.command === command)
      .map((binding) => formatCombo(binding.combo, this.#router.platform));
  }
}
