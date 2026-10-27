/** Keyboard shortcut routing: the focused surface's keymap first, then the global keymap. */
export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type Platform = "mac" | "other";

const MODIFIERS = ["Meta", "Control", "Alt", "Shift"] as const;
const MODIFIER_KEYS = new Set<string>([...MODIFIERS, "OS"]);

/** The canonical name of a key press, modifiers in a fixed order: "Meta+Shift+K", "Escape". */
export function comboOf(event: KeyLike): string {
  const held = [event.metaKey, event.ctrlKey, event.altKey, event.shiftKey];
  const mods = MODIFIERS.filter((_, i) => held[i]);
  return [...mods, keyName(event.key)].join("+");
}

function keyName(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

type Handler = () => void;

export class ShortcutRouter {
  readonly #platform: Platform;
  readonly #global = new Map<string, Handler>();
  readonly #surfaces = new Map<string, Map<string, Handler>>();
  #focused: string | null = null;

  constructor(options: { platform: Platform }) {
    this.#platform = options.platform;
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
    handler();
    return true;
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
    const parts = combo.split("+").map((part) => part.trim());
    const key = parts.pop() ?? "";
    const mods = new Set(
      parts.map((part) =>
        part === "Mod" ? (this.#platform === "mac" ? "Meta" : "Control") : part,
      ),
    );
    return comboOf({
      key,
      metaKey: mods.has("Meta"),
      ctrlKey: mods.has("Control") || mods.has("Ctrl"),
      altKey: mods.has("Alt"),
      shiftKey: mods.has("Shift"),
    });
  }
}
