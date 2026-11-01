/** Keyboard shortcut routing: the focused surface's keymap first, then the global keymap. */
export interface KeyLike {
  key: string;
  /** The physical key (KeyD, Digit1), when the event has it. */
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type Platform = "mac" | "other";

/** Guess the platform from the browser; tests pass it explicitly. */
export function detectPlatform(): Platform {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return /Mac|iPhone|iPad/.test(nav?.platform ?? nav?.userAgent ?? "") ? "mac" : "other";
}

const MODIFIERS = ["Meta", "Control", "Alt", "Shift"] as const;
const MODIFIER_KEYS = new Set<string>([...MODIFIERS, "OS"]);

/** The canonical name of a key press, modifiers in a fixed order: "Meta+Shift+K", "Escape". */
export function comboOf(event: KeyLike): string {
  const held = [event.metaKey, event.ctrlKey, event.altKey, event.shiftKey];
  const mods = MODIFIERS.filter((_, i) => held[i]);
  return [...mods, keyName(event)].join("+");
}

function keyName(event: KeyLike): string {
  // The persisted combo grammar has no whitespace; use the named key for Space chords.
  if (event.key === " ") return "Space";
  // macOS composes Option+letter into another character (⌥D is ∂): with Alt held, a letter or
  // digit key is named by the key itself, so Mod+Alt+D means the same key on every platform.
  const physical = event.altKey ? /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code ?? "") : null;
  if (physical) return physical[1] ?? physical[2] ?? event.key;
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

const ALIASES: Record<string, string> = { Ctrl: "Control", Cmd: "Meta", Option: "Alt" };
/** Modifiers, each followed by +, then the key (which may itself be +). */
const COMBO = /^((?:(?:Mod|Meta|Control|Ctrl|Cmd|Alt|Option|Shift)\+)*)(.+)$/;

function split(combo: string): { mods: string[]; key: string } {
  const match = COMBO.exec(combo.trim());
  return {
    mods: (match?.[1] ?? "").split("+").filter(Boolean),
    key: match?.[2] ?? combo,
  };
}

/** "Mod+Shift+k" → "Meta+Shift+K" on macOS, "Control+Shift+K" elsewhere. */
export function canonical(combo: string, platform: Platform): string {
  const { mods: names, key } = split(combo);
  const mods = new Set(
    names.map((name) =>
      name === "Mod" ? (platform === "mac" ? "Meta" : "Control") : (ALIASES[name] ?? name),
    ),
  );
  return comboOf({
    key,
    metaKey: mods.has("Meta"),
    ctrlKey: mods.has("Control"),
    altKey: mods.has("Alt"),
    shiftKey: mods.has("Shift"),
  });
}

const MAC_SYMBOLS: Record<string, string> = {
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

/** How a canonical combo reads: "⇧⌘K" on macOS, "Ctrl+Shift+K" elsewhere. */
export function formatCombo(combo: string, platform: Platform): string {
  const { mods, key } = split(combo);
  if (platform !== "mac")
    return [...mods.map((m) => (m === "Control" ? "Ctrl" : m)), key].join("+");
  const order = ["Control", "Alt", "Shift", "Meta"];
  const symbols = order.filter((m) => mods.includes(m)).map((m) => MAC_SYMBOLS[m]);
  return [...symbols, MAC_SYMBOLS[key] ?? key].join("");
}

/** A handler returns false when it did nothing, so the key goes on as if unbound. */
type Handler = () => unknown;

export class ShortcutRouter {
  readonly #platform: Platform;
  readonly #global = new Map<string, Handler>();
  readonly #surfaces = new Map<string, Map<string, Handler>>();
  #focused: string | null = null;

  constructor(options: { platform: Platform }) {
    this.#platform = options.platform;
  }

  get platform(): Platform {
    return this.#platform;
  }

  /** Bind a combo such as "Mod+K" (Mod is Meta on macOS, Control elsewhere). Returns an unbind. */
  bind(combo: string, handler: Handler, options: { surface?: string } = {}): () => void {
    const name = this.#canonical(combo);
    const map = options.surface ? this.#surfaceMap(options.surface) : this.#global;
    map.set(name, handler);
    return () => {
      if (map.get(name) === handler) map.delete(name);
    };
  }

  focus(surface: string | null): void {
    this.#focused = surface;
  }

  get focused(): string | null {
    return this.#focused;
  }

  /** Run the handler bound to this key press. Returns whether one ran. */
  handle(event: KeyLike): boolean {
    if (MODIFIER_KEYS.has(event.key)) return false;
    const combo = comboOf(event);
    const handler =
      (this.#focused ? this.#surfaces.get(this.#focused)?.get(combo) : undefined) ??
      this.#global.get(combo);
    if (!handler) return false;
    return handler() !== false;
  }

  #surfaceMap(surface: string): Map<string, Handler> {
    let map = this.#surfaces.get(surface);
    if (!map) {
      map = new Map();
      this.#surfaces.set(surface, map);
    }
    return map;
  }

  #canonical(combo: string): string {
    return canonical(combo, this.#platform);
  }
}
