/**
 * Command bindings: which key runs which command. Defaults below; the person can rebind any command
 * (one key each), and their overrides are what gets saved. "Mod" is ⌘ on macOS and Ctrl elsewhere.
 */
import { comboOf, type Platform } from "../input";

export interface Binding {
  key: string;
  command: string;
}

export const DEFAULT_BINDINGS: readonly Binding[] = [
  { key: "Mod+K", command: "composer.open" },
  { key: "Mod+N", command: "window.new" },
  { key: "Mod+D", command: "pane.splitRight" },
  { key: "Mod+Shift+D", command: "pane.splitDown" },
  { key: "Mod+W", command: "pane.close" },
  { key: "Mod+]", command: "pane.next" },
  { key: "Mod+[", command: "pane.previous" },
  { key: "Control+1", command: "desktop.1" },
  { key: "Control+2", command: "desktop.2" },
  { key: "Control+3", command: "desktop.3" },
  { key: "Control+4", command: "desktop.4" },
  { key: "Escape", command: "ui.dismiss" },
];

const ALIASES: Record<string, string> = { Ctrl: "Control", Cmd: "Meta", Option: "Alt" };

/** "Mod+Shift+d" → "Meta+Shift+D" on macOS, "Control+Shift+D" elsewhere. */
export function canonical(combo: string, platform: Platform): string {
  const parts = combo.split("+").map((part) => part.trim());
  const key = parts.pop() ?? "";
  const mods = new Set(
    parts.map((p) => (p === "Mod" ? (platform === "mac" ? "Meta" : "Control") : (ALIASES[p] ?? p))),
  );
  return comboOf({
    key,
    metaKey: mods.has("Meta"),
    ctrlKey: mods.has("Control"),
    altKey: mods.has("Alt"),
    shiftKey: mods.has("Shift"),
  });
}

const MAC_KEYS: Record<string, string> = {
  Meta: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↩",
};

/** How a binding reads: "⇧⌘D" on macOS, "Ctrl+Shift+D" elsewhere. */
export function format(combo: string, platform: Platform): string {
  const parts = combo.split("+");
  const key = parts.pop() ?? "";
  if (platform !== "mac")
    return [...parts.map((p) => (p === "Control" ? "Ctrl" : p)), key].join("+");
  const order = ["Control", "Alt", "Shift", "Meta"];
  const mods = order.filter((m) => parts.includes(m)).map((m) => MAC_KEYS[m]);
  return [...mods, MAC_KEYS[key] ?? key].join("");
}

/** Whether a combo has a modifier that makes it a command, not typing (Shift alone does not). */
export function isChord(combo: string): boolean {
  return /(^|\+)(Meta|Control|Alt)\+/.test(combo);
}

export class Keymap {
  readonly platform: Platform;
  /** While the person records a new binding, keys go to the recorder instead of commands. */
  recording = false;
  readonly #defaults = new Map<string, string[]>();
  #overrides: Record<string, string[]> = {};
  readonly #listeners = new Set<() => void>();

  constructor(platform: Platform, defaults: readonly Binding[] = DEFAULT_BINDINGS) {
    this.platform = platform;
    for (const b of defaults) {
      const list = this.#defaults.get(b.command) ?? [];
      list.push(canonical(b.key, platform));
      this.#defaults.set(b.command, list);
    }
  }

  /** Replace the overrides (from storage); entries that are not lists of strings are ignored. */
  load(overrides: unknown): void {
    const next: Record<string, string[]> = {};
    if (overrides && typeof overrides === "object") {
      for (const [command, keys] of Object.entries(overrides)) {
        if (Array.isArray(keys) && keys.every((k) => typeof k === "string")) {
          next[command] = keys.map((k) => canonical(k, this.platform));
        }
      }
    }
    this.#overrides = next;
    this.#notify();
  }

  overrides(): Record<string, string[]> {
    return structuredClone(this.#overrides);
  }

  bindingsOf(command: string): string[] {
    return this.#overrides[command] ?? this.#defaults.get(command) ?? [];
  }

  isDefault(command: string): boolean {
    return !(command in this.#overrides);
  }

  /** The command a key press runs. Overrides win over defaults. */
  commandFor(combo: string): string | undefined {
    for (const [command, keys] of Object.entries(this.#overrides)) {
      if (keys.includes(combo)) return command;
    }
    for (const [command, keys] of this.#defaults) {
      if (!(command in this.#overrides) && keys.includes(combo)) return command;
    }
    return undefined;
  }

  /** Bind `combo` to `command` (its only key). Returns the command that had it, if another did. */
  bind(command: string, combo: string): string | undefined {
    const key = canonical(combo, this.platform);
    const displaced = this.#take(key, command);
    this.#overrides[command] = [key];
    this.#notify();
    return displaced;
  }

  unbind(command: string): void {
    this.#overrides[command] = [];
    this.#notify();
  }

  /** Back to the default keys for one command (or all); a default key another command took is taken back. */
  reset(command?: string): void {
    if (command === undefined) this.#overrides = {};
    else {
      delete this.#overrides[command];
      for (const key of this.#defaults.get(command) ?? []) this.#take(key, command);
    }
    this.#notify();
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #take(key: string, from: string): string | undefined {
    let displaced: string | undefined;
    const commands = new Set([...this.#defaults.keys(), ...Object.keys(this.#overrides)]);
    for (const other of commands) {
      if (other === from) continue;
      const keys = this.bindingsOf(other);
      if (!keys.includes(key)) continue;
      this.#overrides[other] = keys.filter((k) => k !== key);
      displaced = other;
    }
    return displaced;
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

/** Guess the platform from the browser; tests pass it explicitly. */
export function detectPlatform(): Platform {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return /Mac|iPhone|iPad/.test(nav?.platform ?? nav?.userAgent ?? "") ? "mac" : "other";
}
