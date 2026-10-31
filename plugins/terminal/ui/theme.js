// The desk's theme as the terminal's: the screen, text, cursor and selection from the --desk-*
// custom properties the desk hands every frame, the sixteen ANSI colours from a palette per scheme,
// and the terminal options that the settings and the theme decide together. No DOM.

/** @typedef {import("@endue-ai/plugin-sdk").ThemeState} ThemeState */
/** @typedef {import("./shell.js").Settings} Settings */

/** The ANSI colours, chosen to read on the desk's dark and light backgrounds. */
export const ANSI = Object.freeze({
  dark: {
    black: "#1e1d21",
    red: "#ff8484",
    green: "#5dbe5f",
    yellow: "#ffb347",
    blue: "#6cadff",
    magenta: "#b6a3f5",
    cyan: "#5fd0be",
    white: "#d7d4dc",
    brightBlack: "#6f6a78",
    brightRed: "#ffa3a3",
    brightGreen: "#86d788",
    brightYellow: "#ffd089",
    brightBlue: "#9cc9ff",
    brightMagenta: "#cfc3ff",
    brightCyan: "#8de0d3",
    brightWhite: "#ffffff",
  },
  light: {
    black: "#1e1833",
    red: "#b80012",
    green: "#006c44",
    yellow: "#925000",
    blue: "#005fa3",
    magenta: "#6b4f9e",
    cyan: "#0d7a6e",
    white: "#9b94a3",
    brightBlack: "#675f70",
    brightRed: "#d83b3b",
    brightGreen: "#2a8a5c",
    brightYellow: "#b5700a",
    brightBlue: "#2f7fc1",
    brightMagenta: "#8a6cc0",
    brightCyan: "#2f9a8e",
    brightWhite: "#ffffff",
  },
});

/** What the desk's tokens are when a theme leaves one out (desk.theme's dark and light). */
const FALLBACK = {
  dark: { background: "#141416", text: "#f2f0f5", accent: "#b6a3f5" },
  light: { background: "#faf9fc", text: "#1e1833", accent: "#6b4f9e" },
};

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
 * xterm.js's theme from the desk's. High contrast selects with the text colour itself.
 * @param {ThemeState} theme
 */
export function xtermTheme(theme) {
  const fallback = FALLBACK[theme.scheme];
  const token = (/** @type {keyof typeof fallback} */ name) =>
    theme.variables[`--desk-${name}`] ?? fallback[name];
  const background = token("background");
  const text = token("text");
  const accent = token("accent");
  const high = theme.contrast === "high";
  return {
    background,
    foreground: text,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: high ? text : withAlpha(accent, 0.35),
    ...(high ? { selectionForeground: background } : {}),
    selectionInactiveBackground: high ? text : withAlpha(accent, 0.2),
    ...ANSI[theme.scheme],
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
