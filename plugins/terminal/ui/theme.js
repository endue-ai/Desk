// The desk's theme as the terminal's: the screen, text, cursor, selection and the sixteen ANSI colours
// from the --desk-* custom properties the desk hands every frame (a theme sets --desk-ansi-0 … 15 per
// scheme), and the terminal options that the settings and the theme decide together. No DOM and no
// colour of its own: what the theme leaves out comes from the page (main.js).

/** @typedef {import("@endue-ai/plugin-sdk").ThemeState} ThemeState */
/** @typedef {import("./shell.js").Settings} Settings */

/** xterm's names for the colours of --desk-ansi-0 … --desk-ansi-15, black to bright white. */
const ANSI_NAMES = [
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
];

/** The --desk-* variables xterm's theme is made of: the screen, text and cursor, and the ANSI colours. */
export const THEME_VARIABLES = Object.freeze([
  "--desk-background",
  "--desk-text",
  "--desk-accent",
  ...ANSI_NAMES.map((_, i) => `--desk-ansi-${i}`),
]);

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
 * xterm.js's theme from the desk's: each colour from its --desk-* variable in the theme, else from
 * `fallback` (the page's own values: main.js reads what tokens.css declares), else xterm's own.
 * High contrast selects with the text colour itself.
 * @param {ThemeState} theme
 * @param {Readonly<Record<string, string>>} [fallback]
 */
export function xtermTheme(theme, fallback = {}) {
  const read = (/** @type {string} */ name) =>
    theme.variables[name]?.trim() || fallback[name]?.trim() || undefined;
  const background = read("--desk-background");
  const text = read("--desk-text");
  const accent = read("--desk-accent");
  const high = theme.contrast === "high";
  const colors = {
    background,
    foreground: text,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: high ? text : accent && withAlpha(accent, 0.35),
    selectionForeground: high ? background : undefined,
    selectionInactiveBackground: high ? text : accent && withAlpha(accent, 0.2),
    ...Object.fromEntries(ANSI_NAMES.map((name, i) => [name, read(`--desk-ansi-${i}`)])),
  };
  return /** @type {Record<string, string>} */ (
    Object.fromEntries(Object.entries(colors).filter(([, value]) => value !== undefined))
  );
}

const HEX = /^#[0-9a-f]{6}$/iu;

/** Search highlights from the terminal's theme: xterm's decorations take #rrggbb only. */
export function searchDecorations(/** @type {{ theme?: Record<string, string> }} */ options) {
  const theme = /** @type {Record<string, string | undefined>} */ (options.theme ?? {});
  const match = theme.yellow;
  const active = theme.cursor;
  if (!match || !active || !HEX.test(match) || !HEX.test(active)) return undefined;
  return {
    matchBorder: match,
    matchOverviewRuler: match,
    activeMatchBorder: active,
    activeMatchColorOverviewRuler: active,
  };
}

/**
 * The options every terminal is made with, and given again when the settings or the theme change.
 * Reduced motion stops the cursor blinking; high contrast asks xterm for a 7:1 ratio on every cell.
 * The Unicode 11 addon is proposed API in xterm, so loading it needs allowProposedApi.
 * @param {Settings} settings
 * @param {ThemeState} theme
 * @param {Readonly<Record<string, string>>} [fallback] the page's values, as for xtermTheme
 */
export function terminalOptions(settings, theme, fallback = {}) {
  return {
    allowProposedApi: true,
    cursorBlink: settings.cursorBlink && !theme.reducedMotion,
    cursorStyle: settings.cursorStyle,
    fontFamily: settings.fontFamily || MONOSPACE,
    fontSize: settings.fontSize,
    scrollback: settings.scrollback,
    minimumContrastRatio: theme.contrast === "high" ? 7 : 1,
    theme: xtermTheme(theme, fallback),
  };
}
