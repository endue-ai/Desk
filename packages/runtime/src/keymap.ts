/**
 * The keymap (desk.keys, like global-map): every contributed binding, resolved by precedence
 * (personal > plugin > core default; within a layer the later one of a key wins) and `"command": ""`
 * taking a key away. A key is a sequence of chords (ADR 0118); a conflict between two bindings is
 * kept and reported, never dropped silently. Keys run commands; a key whose command is off now does
 * nothing and passes on, and one whose command fails says why (gesture.ts).
 */
import type { Commands } from "./commands";
import { type GestureDesk, type Notify, runGesture } from "./gesture";
import { formatCombo, type Platform, type ShortcutRouter } from "./input";
import type { PolicySet } from "./policy";
import {
  type Conflict,
  continuations,
  type KeyEntry,
  type Resolution,
  type Resolved,
  resolveBindings,
} from "./sequences/conflicts";

export interface Binding {
  /** Canonical for the platform: Meta+K, Control+Shift+P, Escape; Meta+K Meta+S for a sequence. */
  combo: string;
  command: string;
  args?: unknown;
  owner: string;
}

const binding = (r: Resolved): Binding => ({
  combo: r.combo,
  command: r.command,
  owner: r.owner,
  ...("args" in r ? { args: r.args } : {}),
});

/** The bindings in force for a platform, one per sequence, in sequence order. */
export function resolveKeymap(keys: PolicySet["keys"], platform: Platform): Binding[] {
  return resolveBindings(keys, platform).bindings.map(binding);
}

/** Keeps the shortcut router bound to the keymap in force. */
export class Keymap {
  readonly #router: ShortcutRouter;
  readonly #commands: Commands;
  readonly #desk: GestureDesk;
  #resolution: Resolution = { bindings: [], conflicts: [], removed: [] };
  #entries: KeyEntry[] = [];
  #unbind: Array<() => void> = [];
  readonly #listeners = new Set<() => void>();

  /** Without `notify` (a bare keymap in tests) a failed command is only logged. */
  constructor(router: ShortcutRouter, commands: Commands, notify: Notify = () => {}) {
    this.#router = router;
    this.#commands = commands;
    this.#desk = { commands, notify };
  }

  apply(keys: KeyEntry[]): void {
    for (const off of this.#unbind) off();
    this.#entries = [...keys];
    this.#resolution = resolveBindings(keys, this.#router.platform);
    this.#unbind = this.#resolution.bindings.map((resolved) =>
      this.#router.bind(resolved.combo, () => {
        if (!this.#commands.has(resolved.command)) return false;
        void runGesture(this.#desk, resolved.command, resolved.args);
      }),
    );
    for (const listener of [...this.#listeners]) listener();
  }

  /** Hear every new set of bindings. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  bindings(): Binding[] {
    return this.#resolution.bindings.map(binding);
  }

  /** Every layer's entries as applied last: the compositor resolves them itself to decide, before
   * it delivers a key, whether the desk takes it (#56). */
  entries(): KeyEntry[] {
    return [...this.#entries];
  }

  /** The bindings in force with their layer and where each is written. */
  resolved(): Resolved[] {
    return [...this.#resolution.bindings];
  }

  /** Every conflict among the bindings applied, the losing binding with its source. */
  conflicts(): Conflict[] {
    return [...this.#resolution.conflicts];
  }

  /** The bindings that continue a pending prefix (the which-key overlay lists them). */
  continuations(prefix: string[]): Resolved[] {
    return continuations(this.#resolution.bindings, prefix);
  }

  /** The keys that run `command`, as people read them on this platform: "⌘K ⌘S". */
  keysFor(command: string): string[] {
    return this.#resolution.bindings
      .filter((resolved) => resolved.command === command)
      .map((resolved) => formatCombo(resolved.combo, this.#router.platform));
  }
}
