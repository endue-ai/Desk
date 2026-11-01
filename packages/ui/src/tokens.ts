/**
 * The desk's design tokens: the endue design system as `--desk-*` custom properties
 * (docs/design-system.md). `colors` are role colours a theme sets per scheme (plugins/theme carries
 * the light set and the high-contrast layers); `scale` is type, space, radius, control height and
 * motion, the same under every theme. Plugin pages and the shell read both.
 */

/** Role colours, with the dark scheme's values. A theme redefines any of them; none is a literal elsewhere. */
export const colors = {
  // Surfaces: the page, a card or panel, a sunken track, a floating layer, the hover and selected row.
  background: "#141416",
  card: "#1e1d21",
  muted: "#242127",
  popover: "#2b2731",
  hover: "#37313f",
  // Text on those surfaces.
  text: "#f2f0f5",
  textMuted: "#b0adb7",
  // The brand action: a lavender fill, the ink on it, its hover, and the brand as text or a tint.
  primary: "#b6a3f5",
  primaryForeground: "#1e1833",
  primaryHover: "#c8b9ff",
  primaryText: "#b6a3f5",
  primarySubtle: "rgba(182, 163, 245, 0.08)",
  primarySoft: "rgba(182, 163, 245, 0.12)",
  primaryBorder: "rgba(182, 163, 245, 0.34)",
  /** @deprecated the brand fill under its old name; read `primary` (fills) or `primaryText` (text). */
  accent: "#b6a3f5",
  // Status: a fill, the ink on it, the colour as text on a neutral surface, a tinted surface and border.
  success: "#5dbe5f",
  successForeground: "#141416",
  successText: "#5dbe5f",
  successSoft: "rgba(93, 190, 95, 0.16)",
  successBorder: "rgba(93, 190, 95, 0.4)",
  warning: "#ff9800",
  warningForeground: "#141416",
  warningText: "#ff9800",
  warningSoft: "rgba(255, 152, 0, 0.16)",
  warningBorder: "rgba(255, 152, 0, 0.4)",
  danger: "#ff8484",
  dangerForeground: "#1e1833",
  dangerText: "#ff8484",
  dangerSoft: "rgba(255, 132, 132, 0.16)",
  dangerBorder: "rgba(255, 132, 132, 0.4)",
  info: "#6cadff",
  infoForeground: "#141416",
  infoText: "#6cadff",
  infoSoft: "rgba(108, 173, 255, 0.16)",
  infoBorder: "rgba(108, 173, 255, 0.4)",
  // Structure: dividers, the border of an input or an idle control, the focus and selection ring.
  border: "#333136",
  input: "#837991",
  ring: "#b6a3f5",
  // Floating layers.
  tooltip: "#403a49",
  tooltipText: "#f2f0f5",
  scrim: "rgba(0, 0, 0, 0.6)",
  shadowSm: "0 1px 2px rgba(0, 0, 0, 0.4)",
  shadowMd: "0 8px 24px rgba(0, 0, 0, 0.45)",
  shadowLg: "0 20px 48px rgba(0, 0, 0, 0.55)",
  // Categorical colours for charts and lanes, used in order and fixed to their subject.
  chart1: "#b6a3f5",
  chart2: "#5fd0be",
  chart3: "#e8c98a",
  chart4: "#5b9bf5",
  chart5: "#e0738a",
  chart6: "#8fd36b",
  chart7: "#f5a35b",
  chart8: "#a7b1c3",
} as const;

/** Type, space, radius, control heights and motion. Themes leave these alone. */
export const scale = {
  fontSans:
    '"Inter", "SUIT Variable", "SUIT", -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  fontMono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  // Type: 2xs only for badges, rail labels and chart axes; sm is the UI's text, base a document's.
  text2xs: "11px",
  textXs: "12px",
  textSm: "14px",
  textBase: "16px",
  textLg: "18px",
  textXl: "20px",
  text2xl: "24px",
  text3xl: "32px",
  text4xl: "40px",
  // Space: a 4px grid.
  space1: "4px",
  space2: "8px",
  space3: "12px",
  space4: "16px",
  space5: "20px",
  space6: "24px",
  space8: "32px",
  space10: "40px",
  space12: "48px",
  space16: "64px",
  // Control heights: sm for a plugin page's bars and rows, md for forms and dialog footers.
  controlXs: "28px",
  controlSm: "32px",
  controlMd: "40px",
  controlLg: "48px",
  // Radius: sm for badges and menu items, md for buttons, inputs and menus, lg for cards and dialogs.
  radiusSm: "4px",
  radiusMd: "8px",
  radiusLg: "12px",
  radiusFull: "9999px",
  // Motion: 0ms under reduced motion (the runtime sets that, see resolveTheme).
  motionFast: "150ms",
  motionBase: "220ms",
  motionSlow: "400ms",
  motionTheme: "350ms",
} as const;

/** Every token: what `tokens.css` declares and what the runtime applies to each frame as `--desk-*`. */
export const tokens = { ...scale, ...colors } as const;

export type ColorTokens = { readonly [K in keyof typeof colors]: string };
export type ScaleTokens = { readonly [K in keyof typeof scale]: string };
export type ThemeTokens = { readonly [K in keyof typeof tokens]: string };

/** The tokens the runtime zeroes under reduced motion. */
export const MOTION_TOKENS = ["motionFast", "motionBase", "motionSlow", "motionTheme"] as const;

/** A token name as its custom property: `textMuted` → `--desk-text-muted`, `text2xs` → `--desk-text-2xs`. */
export function propertyOf(name: string): string {
  return `--desk-${name
    .replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    .replace(/([a-z])(\d)/g, "$1-$2")}`;
}

/** The tokens as CSS custom properties. Themes may add tokens; they follow the same naming. */
export function cssVariables(
  theme: Readonly<Record<string, string>> = tokens,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(theme).flatMap(([name, value]) => {
      const property = propertyOf(name);
      const legacy = `--desk-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      // Older cssVariables callers used unsplit digits in custom token names.
      return property === legacy
        ? [[property, value]]
        : [
            [property, value],
            [legacy, value],
          ];
    }),
  );
}
