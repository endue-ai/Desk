/**
 * The desk's design tokens: the endue design system as `--desk-*` custom properties
 * (docs/design-system.md). `colors` are role colours a theme sets per scheme (plugins/theme carries
 * the light set and the high-contrast layers); `scale` is type, space, radius, control height and
 * motion, which a theme's type, shape and motion layers retune; `material` is what surfaces are made
 * of and what lies behind the windows, per scheme; `terminal` is the sixteen ANSI colours. Plugin pages
 * and the shell read them all; a theme (docs/ko/theme-requirements.md) sets them through
 * `@endue-ai/ui/theme`.
 */

import { componentTokens } from "./design/compile";

/**
 * Role colours, with the dark scheme's values: Stone, endue.ai/design's dark theme (warm black with
 * paper-coloured text; plugins/theme carries Ink, the light one). The fill is ink and there is one:
 * `primary` is the main action's fill and never a decoration; selection is a surface (`hover`,
 * `primarySoft`); the one colour is `star`, the mark of an agent at work (ADR 0265). A theme
 * redefines any of them; none is a literal elsewhere.
 */
export const colors = {
  // Surfaces: the page, a card or panel, a sunken track, a floating layer, the hover and selected row.
  background: "#141311",
  card: "#1d1c19",
  muted: "#23211e",
  popover: "#2a2824",
  hover: "#35322d",
  // Text on those surfaces.
  text: "#f3f1ec",
  textMuted: "#b3afa5",
  // The main action: the ink fill (paper in the dark), the ink on it, its hover, the brand as text,
  // and the sunken, selected and outline surfaces it shares with the neutrals.
  primary: "#f3f1ec",
  primaryForeground: "#1c1a17",
  primaryHover: "#dcd8cf",
  primaryText: "#f3f1ec",
  primarySubtle: "#23211e",
  primarySoft: "#35322d",
  primaryBorder: "#32302b",
  /** @deprecated the brand fill under its old name; read `primary` (fills) or `primaryText` (text). */
  accent: "#f3f1ec",
  // The one colour: the star an agent at work shows, and nothing else (3:1 on the surfaces).
  star: "#b6a3f5",
  // Status: a fill, the ink on it, the colour as text on a neutral surface, a tinted surface and border.
  success: "#4caf50",
  successForeground: "#1c1a17",
  successText: "#5dbe5f",
  successSoft: "rgba(76, 175, 80, 0.12)",
  successBorder: "rgba(76, 175, 80, 0.34)",
  warning: "#ff9800",
  warningForeground: "#1c1a17",
  warningText: "#ff9800",
  warningSoft: "rgba(255, 152, 0, 0.12)",
  warningBorder: "rgba(255, 152, 0, 0.34)",
  danger: "#ff6467",
  dangerForeground: "#1c1a17",
  dangerText: "#ff8484",
  dangerSoft: "rgba(255, 100, 103, 0.12)",
  dangerBorder: "rgba(255, 100, 103, 0.34)",
  info: "#5b9bf5",
  infoForeground: "#1c1a17",
  infoText: "#6cadff",
  infoSoft: "rgba(91, 155, 245, 0.12)",
  infoBorder: "rgba(91, 155, 245, 0.34)",
  // Structure: dividers, the border of an input or an idle control, the focus and selection ring.
  border: "#32302b",
  input: "#858177",
  ring: "#f3f1ec",
  // Floating layers.
  tooltip: "#403d37",
  tooltipText: "#f3f1ec",
  scrim: "rgba(0, 0, 0, 0.6)",
  shadowSm: "0 1px 2px rgba(0, 0, 0, 0.4)",
  shadowMd: "0 8px 24px rgba(0, 0, 0, 0.45)",
  shadowLg: "0 20px 48px rgba(0, 0, 0, 0.55)",
  // Categorical colours for charts and lanes, used in order and fixed to their subject: data, not
  // decoration.
  chart1: "#9683d3",
  chart2: "#00ae75",
  chart3: "#ca8000",
  chart4: "#b259ff",
  chart5: "#f74a5d",
  chart6: "#009fac",
  chart7: "#d95926",
  chart8: "#3987e5",
  chart9: "#008300",
  chart10: "#d55181",
  // Code: a block's tint over the surface, and the colours of its tokens (4.5:1 on that tint).
  codeSurface: "rgba(243, 241, 236, 0.06)",
  codeComment: "#b3afa5",
  codePunctuation: "rgba(243, 241, 236, 0.65)",
  codeKeyword: "#b6a3f5",
  codeString: "#5dbe5f",
  codeNumber: "#ff9800",
  codeFunction: "#6cadff",
  codeTag: "#ff8484",
  codeProperty: "#3cacb8",
} as const;

/** Type, space, radius, control heights and motion: a theme's type, shape and motion presets set them. */
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
  // Letter spacing of body text.
  tracking: "0em",
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
  // The curve the motion tokens move along.
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const;

/** What surfaces are made of and what the desk shows behind its windows: a theme's material and backdrop. */
export const material = {
  // Surfaces' opacity (0.6 to 1): below 1 the backdrop shows through, blurred by `blur`.
  surfaceOpacity: "1",
  blur: "0px",
  // Grain over surfaces, 0 to 0.15.
  noise: "0",
  borderWidth: "1px",
  // One background-image layer behind the shell: none, a gradient or an image's url().
  backdrop: "none",
  backdropSize: "cover",
  backdropRepeat: "no-repeat",
} as const;

/** The terminal's ANSI colours, black to bright white, with the dark scheme's values. */
export const terminal = {
  ansi0: "#1d1c19",
  ansi1: "#ff8484",
  ansi2: "#5dbe5f",
  ansi3: "#ffb347",
  ansi4: "#6cadff",
  ansi5: "#b6a3f5",
  ansi6: "#5fd0be",
  ansi7: "#d8d4cb",
  ansi8: "#6f6b63",
  ansi9: "#ffa3a3",
  ansi10: "#86d788",
  ansi11: "#ffd089",
  ansi12: "#9cc9ff",
  ansi13: "#cfc3ff",
  ansi14: "#8de0d3",
  ansi15: "#ffffff",
} as const;

/**
 * The endue design system's component tokens (ADR 0090): what each component is made of, as references
 * to the tokens above. A design system (`@endue-ai/ui/design`) replaces them; a theme never does.
 */
export const components: Readonly<Record<string, string>> = componentTokens;

/** Every token: what `tokens.css` declares and what the runtime applies to each frame as `--desk-*`. */
export const tokens = { ...scale, ...colors, ...material, ...terminal, ...components } as const;

export type ColorTokens = { readonly [K in keyof typeof colors]: string };
export type ScaleTokens = { readonly [K in keyof typeof scale]: string };
export type MaterialTokens = { readonly [K in keyof typeof material]: string };
export type TerminalTokens = { readonly [K in keyof typeof terminal]: string };
export type ThemeTokens = { readonly [K in keyof typeof tokens]: string } & Readonly<
  Record<string, string>
>;

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
