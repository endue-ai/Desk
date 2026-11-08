/**
 * One chord: modifiers held and one key, the unit a key sequence is made of. A key press is named
 * the same way on every platform ("Meta+Shift+K", "Escape"); `Mod` is Meta on macOS and Control
 * elsewhere. `input.ts` re-exports these for the router and for older callers.
 */
export interface KeyLike {
  key: string;
  /** The physical key (KeyD, Digit1), when the event has it. */
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** A held key repeating, when the event says so. */
  repeat?: boolean;
}

export type Platform = "mac" | "other";

const MODIFIERS = ["Meta", "Control", "Alt", "Shift"] as const;
/** Keys that are only modifiers: pressing one alone is not a chord. */
export const MODIFIER_KEYS = new Set<string>([...MODIFIERS, "OS"]);

/** The canonical name of a key press, modifiers in a fixed order: "Meta+Shift+K", "Escape". */
export function comboOf(event: KeyLike): string {
  const held = [event.metaKey, event.ctrlKey, event.altKey, event.shiftKey];
  const mods = MODIFIERS.filter((_, i) => held[i]);
  return [...mods, keyName(event)].join("+");
}

/** What Shift makes of a key on a US keyboard, back to the key: ⇧/ arrives as "?", ⇧1 as "!". */
const UNSHIFTED: Record<string, string> = {
  "?": "/",
  ">": ".",
  "<": ",",
  ":": ";",
  '"': "'",
  "{": "[",
  "}": "]",
  "|": "\\",
  _: "-",
  "+": "=",
  "~": "`",
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
};

function keyName(event: KeyLike): string {
  // The persisted grammar separates chords with a space; use the named key for Space chords.
  if (event.key === " ") return "Space";
  // With Shift held a digit is named by its key, so Mod+Shift+1 matches ⇧⌘1 whatever the layout
  // puts on it ("!" on a US keyboard); without the physical key, the US table says.
  const digit = event.shiftKey ? /^Digit([0-9])$/.exec(event.code ?? "") : null;
  if (digit?.[1]) return digit[1];
  // With Shift held a punctuation key is named by the key, so Mod+Shift+/ matches ⌘⇧/ (which
  // arrives as "?"), in the main window and from a plugin frame alike.
  const unshifted = event.shiftKey ? UNSHIFTED[event.key] : undefined;
  if (unshifted) return unshifted;
  // macOS composes Option+letter into another character (⌥D is ∂): with Alt held, a letter or
  // digit key is named by the key itself, so Mod+Alt+D means the same key on every platform.
  const physical = event.altKey ? /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code ?? "") : null;
  if (physical) return physical[1] ?? physical[2] ?? event.key;
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

const ALIASES: Record<string, string> = { Ctrl: "Control", Cmd: "Meta", Option: "Alt" };
/** Modifiers, each followed by +, then the key (which may itself be +). */
const CHORD = /^((?:(?:Mod|Meta|Control|Ctrl|Cmd|Alt|Option|Shift)\+)*)(.+)$/;

/** A chord's modifiers as written and its key. */
export function splitChord(chord: string): { mods: string[]; key: string } {
  const match = CHORD.exec(chord.trim());
  return {
    mods: (match?.[1] ?? "").split("+").filter(Boolean),
    key: match?.[2] ?? chord,
  };
}

/** "Mod+Shift+k" → "Meta+Shift+K" on macOS, "Control+Shift+K" elsewhere. */
export function canonicalChord(chord: string, platform: Platform): string {
  const { mods: names, key } = splitChord(chord);
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

/** How a canonical chord reads: "⇧⌘K" on macOS, "Ctrl+Shift+K" elsewhere. */
export function formatChord(chord: string, platform: Platform): string {
  const { mods, key } = splitChord(chord);
  if (platform !== "mac")
    return [...mods.map((m) => (m === "Control" ? "Ctrl" : m)), key].join("+");
  const order = ["Control", "Alt", "Shift", "Meta"];
  const symbols = order.filter((m) => mods.includes(m)).map((m) => MAC_SYMBOLS[m]);
  return [...symbols, MAC_SYMBOLS[key] ?? key].join("");
}

/** Whether a canonical chord holds Meta, Control or Alt (what a plugin frame forwards). */
export function isChorded(chord: string): boolean {
  const { mods } = splitChord(chord);
  return mods.some((mod) => mod === "Meta" || mod === "Control" || mod === "Alt");
}
