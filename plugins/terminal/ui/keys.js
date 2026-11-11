// Which keys the terminal keeps for the shell and which it hands to the desk's keymap or the
// clipboard. Inside a terminal Control chords and Escape belong to the shell, so the desk's own
// chords are listed here and stay reachable; a setting adds more. No DOM: the view asks with the
// key press, and the tests ask directly.

/** @typedef {import("./shell.js").Platform} Platform */
/**
 * @typedef {{ key: string, metaKey: boolean, ctrlKey: boolean, altKey: boolean, shiftKey: boolean }} KeyPress
 * @typedef {"terminal" | "desk" | "copy" | "paste" | "find" | { type: string }} Decision `type`:
 *   the shell's, as this text instead of xterm's own sequence for the key.
 */

/**
 * Option and an arrow on macOS move a word, as Terminal.app and iTerm2 send them (ESC b, ESC f);
 * xterm 6 sends the modified arrows (ESC [1;3D), which a stock zsh or bash types as text (#160).
 * @type {Record<string, string>}
 */
const MAC_TYPED = { "Alt+ArrowLeft": "\x1bb", "Alt+ArrowRight": "\x1bf" };

/**
 * The desk's chords that a terminal never swallows, as the core and the shell bind them. Mod is
 * Meta on macOS and Control elsewhere, as in the runtime's keymap.
 */
export const DESK_KEYS = Object.freeze([
  "Alt+Space",
  "Mod+K",
  "Mod+Shift+P",
  "Mod+/",
  "Mod+,",
  // desk.describe.open; with Shift held the browser names the key "?", so both forms reach the desk.
  "Mod+Shift+/",
  "Mod+Shift+?",
  "Mod+B",
  "Mod+W",
  "Mod+Alt+ArrowRight",
  "Mod+Alt+ArrowLeft",
  "Mod+N",
  "Mod+D",
  "Mod+Alt+D",
  // Arranging windows (ADR 0116): tile, cascade, spread, restore.
  "Mod+Alt+G",
  "Mod+Alt+C",
  "Mod+Alt+S",
  "Mod+Alt+Z",
  "Mod+]",
  "Mod+[",
  "Mod+O",
  "Mod+Shift+O",
  "Mod+S",
  "Mod+Shift+L",
  "Mod+Shift+N",
  "Mod+Shift+D",
  "Mod+Shift+M",
  "Mod+Shift+T",
  "Control+`",
  "Control+Tab",
  "Control+Shift+Tab",
  "Control+1",
  "Control+2",
  "Control+3",
  "Control+4",
]);

const MODIFIERS = ["Meta", "Control", "Alt", "Shift"];
/** @type {Record<string, string>} */
const ALIASES = { Ctrl: "Control", Cmd: "Meta", Option: "Alt" };
/** Modifiers, each followed by +, then the key (which may itself be +). */
const COMBO = /^((?:(?:Mod|Meta|Control|Ctrl|Cmd|Alt|Option|Shift)\+)*)(.+)$/u;

/** A press as the runtime's keymap names it: modifiers in a fixed order, a single character upper-cased. */
export function comboOf(/** @type {KeyPress} */ press) {
  const held = [press.metaKey, press.ctrlKey, press.altKey, press.shiftKey];
  const key =
    press.key === " " ? "Space" : press.key.length === 1 ? press.key.toUpperCase() : press.key;
  return [...MODIFIERS.filter((_, i) => held[i]), key].join("+");
}

/**
 * A combo as people write it (Mod, Ctrl, Cmd, Option) in the form `comboOf` produces on `platform`.
 * @param {string} combo
 * @param {Platform} platform
 */
export function canonical(combo, platform) {
  const match = COMBO.exec(combo.trim());
  const names = (match?.[1] ?? "").split("+").filter(Boolean);
  const key = match?.[2] ?? combo.trim();
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

/**
 * Who gets a key pressed in a terminal. The desk's chords (and the setting's) go to the desk. On
 * macOS every other Command chord goes to the desk too, apart from Command+C over a selection and
 * Command+V, which are the clipboard's, and Command+F, the terminal's search; elsewhere
 * Control+Shift+C and Control+Shift+V are the clipboard's, as is Control+C over a selection and
 * Control+V, and Control+Shift+F is search. Everything else, Escape and Control chords included, is
 * the shell's; Option+← and Option+→ on macOS as the words they move by (MAC_TYPED).
 * @param {KeyPress} press
 * @param {{ platform: Platform, deskKeys?: readonly string[], hasSelection?: boolean }} context
 * @returns {Decision}
 */
export function decide(press, { platform, deskKeys = [], hasSelection = false }) {
  const combo = comboOf(press);
  const toDesk = [...DESK_KEYS, ...deskKeys].some((chord) => canonical(chord, platform) === combo);
  if (toDesk) return "desk";
  const letter = press.key.length === 1 ? press.key.toLowerCase() : "";
  if (platform === "mac") {
    const typed = MAC_TYPED[combo];
    if (typed) return { type: typed };
    if (!press.metaKey) return "terminal";
    if (press.altKey || press.shiftKey) return "desk";
    if (letter === "c" && hasSelection) return "copy";
    if (letter === "v") return "paste";
    if (letter === "f") return "find";
    return "desk";
  }
  if (!press.ctrlKey || press.altKey || press.metaKey) return "terminal";
  if (press.shiftKey) {
    return letter === "c"
      ? "copy"
      : letter === "v"
        ? "paste"
        : letter === "f"
          ? "find"
          : "terminal";
  }
  if (letter === "c" && hasSelection) return "copy";
  if (letter === "v") return "paste";
  return "terminal";
}
