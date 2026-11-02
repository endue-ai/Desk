// The desk's theme as the terminal's: the screen, text, cursor, selection and the sixteen ANSI colours
// from the --desk-* custom properties the desk hands every frame (a theme sets --desk-ansi-0 … 15 per
// scheme), and the terminal options that the settings and the theme decide together. No DOM.

/** @typedef {import("@endue-ai/plugin-sdk").ThemeState} ThemeState */
/** @typedef {import("./shell.js").Settings} Settings */

/** xterm's names for the colours of --desk-ansi-0 … --desk-ansi-15, black to bright white. */
export const ANSI_NAMES = Object.freeze([
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
]);

/**
 * The tokens when the desk has handed none (before its first theme, or a theme that leaves one out):
 * @endue-ai/ui's defaults for dark, desk.theme's light set for light. They are copies of the theme's
 * own values, not colours of the terminal's, so they are kept as 0xRRGGBB numbers rather than colour
 * strings; tests/theme-tokens.test.ts keeps them equal to those sources.
 */
const DEFAULTS = {
  dark: {
    background: 0x141416,
    text: 0xf2f0f5,
    accent: 0xb6a3f5,
    ansi: [
      0x1e1d21, 0xff8484, 0x5dbe5f, 0xffb347, 0x6cadff, 0xb6a3f5, 0x5fd0be, 0xd7d4dc, 0x6f6a78,
      0xffa3a3, 0x86d788, 0xffd089, 0x9cc9ff, 0xcfc3ff, 0x8de0d3, 0xffffff,
    ],
  },
  light: {
    background: 0xfaf9fc,
    text: 0x1e1833,
    accent: 0x6b4f9e,
    ansi: [
      0x1e1833, 0xb80012, 0x006c44, 0x925000, 0x005fa3, 0x6b4f9e, 0x0d7a6e, 0x9b94a3, 0x675f70,
      0xd83b3b, 0x2a8a5c, 0xb5700a, 0x2f7fc1, 0x8a6cc0, 0x2f9a8e, 0xffffff,
    ],
  },
};

const hex = (/** @type {number} */ value) => `#${value.toString(16).padStart(6, "0")}`;

const named = (/** @type {number[]} */ ansi) =>
  Object.fromEntries(ANSI_NAMES.map((name, i) => [name, hex(ansi[i])]));

/** The ANSI colours when the theme gives none, by xterm's names, per scheme. */
export const ANSI = Object.freeze({
  dark: named(DEFAULTS.dark.ansi),
  light: named(DEFAULTS.light.ansi),
});

/** The platform's monospace font, when the settings name none. */
export const MONOSPACE =
  'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Noto Sans Mono", monospace';

/** `#rrggbb` with an alpha, or the colour as it is when it is not a six-digit hex. */
export function withAlpha(/** @type {string} */ color, /** @type {number} */ alpha) {
  if (!/^#[0-9a-f]{6}$/iu.test(color)) return color;
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${color}${byte.toString(16).padStart(2, "0")}`;
}

/**
 * xterm.js's theme from the desk's: each colour from its --desk-* variable, or the default when the
 * theme leaves it out. High contrast selects with the text colour itself.
 * @param {ThemeState} theme
 */
export function xtermTheme(theme) {
  const scheme = theme.scheme === "light" ? "light" : "dark";
  const read = (/** @type {string} */ name, /** @type {string} */ fallback) =>
    theme.variables[`--desk-${name}`]?.trim() || fallback;
  const background = read("background", hex(DEFAULTS[scheme].background));
  const text = read("text", hex(DEFAULTS[scheme].text));
  const accent = read("accent", hex(DEFAULTS[scheme].accent));
  const high = theme.contrast === "high";
  return {
    background,
    foreground: text,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: high ? text : withAlpha(accent, 0.35),
    ...(high ? { selectionForeground: background } : {}),
    selectionInactiveBackground: high ? text : withAlpha(accent, 0.2),
    ...Object.fromEntries(
      ANSI_NAMES.map((name, i) => [name, read(`ansi-${i}`, ANSI[scheme][name])]),
    ),
  };
}

/**
 * The options every terminal is made with, and given again when the settings or the theme change.
 * Reduced motion stops the cursor blinking; high contrast asks xterm for a 7:1 ratio on every cell.
 * The Unicode 11 addon is proposed API in xterm, so loading it needs allowProposedApi.
 * @param {Settings} settings
 * @param {ThemeState} theme
 */
export function terminalOptions(settings, theme) {
  return {
    allowProposedApi: true,
    cursorBlink: settings.cursorBlink && !theme.reducedMotion,
    cursorStyle: settings.cursorStyle,
    fontFamily: settings.fontFamily || MONOSPACE,
    fontSize: settings.fontSize,
    scrollback: settings.scrollback,
    minimumContrastRatio: theme.contrast === "high" ? 7 : 1,
    theme: xtermTheme(theme),
  };
}
