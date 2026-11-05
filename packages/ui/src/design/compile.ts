/**
 * Compile a design system's recipe into component tokens (ADR 0090, DH-04): `--desk-<component>-<part>`
 * whose values point at the theme's tokens (`var(--desk-radius-full)`, `var(--desk-primary-soft)`) or
 * are bounded constants (a weight, a case, a border width). Colours come only in the pairs the theme
 * gate checks (gate.ts TEXT_PAIRS), so no theme with any design system loses contrast (DC-05).
 */
import { type DesignRecipe, type FullRecipe, fillRecipe } from "./catalogue";

const v = (token: string) => `var(--desk-${token})`;
const NONE = "transparent";

const RADIUS: Record<string, string> = {
  none: "0",
  sm: v("radius-sm"),
  md: v("radius-md"),
  lg: v("radius-lg"),
  full: v("radius-full"),
};
const CONTROL: Record<string, string> = {
  xs: v("control-xs"),
  sm: v("control-sm"),
  md: v("control-md"),
  lg: v("control-lg"),
};
const SHADOW: Record<string, string> = {
  none: "none",
  sm: v("shadow-sm"),
  md: v("shadow-md"),
  lg: v("shadow-lg"),
};
const WEIGHT: Record<string, string> = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
};
const PADDING: Record<string, string> = {
  tight: v("space-2"),
  normal: v("space-3"),
  roomy: v("space-4"),
};
/** A row's or a cell's padding, block then inline, per size step. */
const SPACING: Record<string, string[]> = {
  xs: ["2px", "6px"],
  sm: ["6px", "10px"],
  md: [v("space-2"), v("space-3")],
  lg: [v("space-3"), v("space-4")],
};
const CASE = (choice: string) =>
  choice === "uppercase" ? ["uppercase", "0.04em"] : ["none", "normal"];

type Tokens = Record<string, string>;

/** A filled, soft or outlined fill of a tone (`primary`, `danger`): bg, fg, border and their hover. */
function tone(name: string, style: string): string[] {
  const hover = name === "primary" ? v("primary-hover") : v(name);
  switch (style) {
    case "soft":
      return [
        v(`${name}-soft`),
        v(`${name}-text`),
        NONE,
        v(`${name}-soft`),
        v(`${name}-text`),
        v(`${name}-border`),
      ];
    case "outline":
      return [
        NONE,
        v(`${name}-text`),
        v(`${name}-border`),
        v(`${name}-soft`),
        v(`${name}-text`),
        v(`${name}-border`),
      ];
    default:
      return [v(name), v(`${name}-foreground`), v(name), hover, v(`${name}-foreground`), hover];
  }
}

const PARTS = ["Bg", "Fg", "Border", "HoverBg", "HoverFg", "HoverBorder"];
const put = (out: Tokens, prefix: string, values: string[]) => {
  PARTS.forEach((part, i) => {
    out[`${prefix}${part}`] = values[i] as string;
  });
};

function button(r: FullRecipe["button"], out: Tokens) {
  const [textCase, tracking] = CASE(r.case);
  out.buttonRadius = RADIUS[r.shape] as string;
  out.buttonHeight = CONTROL[r.size] as string;
  out.buttonPaddingX = PADDING[r.padding] as string;
  out.buttonWeight = WEIGHT[r.weight] as string;
  out.buttonCase = textCase as string;
  out.buttonTracking = tracking as string;
  out.buttonShadow = SHADOW[r.elevation] as string;
  const quiet = [NONE, v("text"), NONE, v("hover"), v("text"), NONE];
  const secondary =
    r.secondary === "soft"
      ? [v("muted"), v("text"), NONE, v("hover"), v("text"), NONE]
      : r.secondary === "ghost"
        ? quiet
        : [NONE, v("text"), v("input"), v("hover"), v("text"), v("input")];
  put(out, "button", secondary);
  put(out, "buttonPrimary", tone("primary", r.primary));
  put(out, "buttonDanger", tone("danger", r.primary));
  put(out, "buttonQuiet", quiet);
}

function iconButton(r: FullRecipe["iconButton"], out: Tokens) {
  out.iconButtonRadius = RADIUS[r.shape] as string;
  out.iconButtonSize = CONTROL[r.size] as string;
  out.iconButtonBg = r.style === "soft" ? v("muted") : NONE;
  out.iconButtonBorder = r.style === "outline" ? v("input") : NONE;
  out.iconButtonFg = v("text");
  out.iconButtonHoverBg = v("hover");
}

function field(r: FullRecipe["field"], out: Tokens) {
  const underline = r.style === "underline";
  out.fieldRadius = underline ? "0" : (RADIUS[r.shape] as string);
  out.fieldHeight = CONTROL[r.size] as string;
  out.fieldPaddingX = underline ? "0" : v("space-3");
  out.fieldBg = r.style === "filled" ? v("muted") : underline ? NONE : v("card");
  out.fieldBorderColor = r.style === "filled" ? NONE : v("input");
  out.fieldBorderWidth = underline ? "0 0 1px" : "1px";
  out.fieldFocusBorder = r.focus === "border" ? v("ring") : out.fieldBorderColor;
  out.fieldFocusRing = r.focus === "border" ? NONE : v("ring");
}

function check(r: FullRecipe["check"], out: Tokens) {
  out.checkAccent = r.accent === "text" ? v("text") : v("primary");
  out.checkSize = { xs: "12px", sm: "14px", md: "16px", lg: "20px" }[r.size] as string;
}

function tabs(r: FullRecipe["tabs"], out: Tokens) {
  const pill = r.style === "pill";
  const underline = r.style === "underline";
  out.tabsBg = pill ? v("muted") : NONE;
  out.tabsRadius = pill ? v("radius-full") : "0";
  out.tabsGap = underline ? v("space-3") : v("space-1");
  out.tabRadius = pill ? v("radius-full") : underline ? "0" : (RADIUS[r.shape] as string);
  out.tabHeight = CONTROL[r.size] as string;
  out.tabPaddingX = underline ? v("space-1") : v("space-3");
  out.tabFg = underline ? v("text-muted") : v("text");
  out.tabBorder = r.style === "boxed" ? v("border") : NONE;
  out.tabHoverBg = underline ? NONE : v("hover");
  out.tabSelectedBg = pill ? v("primary") : underline ? NONE : v("primary-soft");
  out.tabSelectedFg = pill ? v("primary-foreground") : v("text");
  out.tabSelectedBorder = r.style === "boxed" ? v("primary") : NONE;
  out.tabSelectedShadow = underline ? `inset 0 -2px 0 ${v("primary")}` : "none";
}

function card(r: FullRecipe["card"], out: Tokens) {
  out.cardRadius = RADIUS[r.shape] as string;
  out.cardPadding = { tight: v("space-2"), normal: v("space-3"), roomy: v("space-5") }[
    r.padding
  ] as string;
  out.cardBg = r.style === "filled" ? v("muted") : r.style === "plain" ? NONE : v("card");
  out.cardBorder = r.style === "outline" ? v("border") : NONE;
  out.cardShadow = r.style === "elevated" ? v("shadow-md") : "none";
}

function row(r: FullRecipe["row"], out: Tokens) {
  out.rowRadius = RADIUS[r.shape] as string;
  const [y, x] = SPACING[r.size] as string[];
  out.rowPaddingY = y as string;
  out.rowPaddingX = x as string;
  out.rowActiveBg = r.selection === "soft" ? v("primary-soft") : v("hover");
  out.rowActiveFg = v("text");
  out.rowActiveShadow = r.selection === "bar" ? `inset 3px 0 0 ${v("primary")}` : "none";
  out.rowSelectedFg = v("primary-text");
}

function surfaces(r: FullRecipe, out: Tokens) {
  out.menuRadius = RADIUS[r.menu.shape] as string;
  out.menuShadow = SHADOW[r.menu.elevation] as string;
  out.menuBorder = r.menu.border === "none" ? NONE : v("border");
  out.menuBg = v("popover");
  out.dialogRadius = RADIUS[r.dialog.shape] as string;
  out.dialogShadow = SHADOW[r.dialog.elevation] as string;
  out.dialogPadding = { tight: v("space-3"), normal: v("space-4"), roomy: v("space-6") }[
    r.dialog.padding
  ] as string;
  out.dialogBg = v("popover");
  out.dialogBorder = v("border");
  out.dialogScrim = v("scrim");
  out.dialogScrimFilter = r.dialog.scrim === "dim" ? "none" : "blur(8px)";
  const t = r.toast.style;
  out.toastRadius = RADIUS[r.toast.shape] as string;
  out.toastShadow = SHADOW[r.toast.elevation] as string;
  out.toastBg = t === "inverse" ? v("tooltip") : t === "soft" ? v("muted") : v("card");
  out.toastFg = t === "inverse" ? v("tooltip-text") : v("text");
  out.toastBorder = t === "outline" ? v("border") : NONE;
  out.tooltipRadius = RADIUS[r.tooltip.shape] as string;
  out.tooltipShadow = SHADOW[r.tooltip.elevation] as string;
}

function marks(r: FullRecipe, out: Tokens) {
  const b = r.badge.style;
  const [badgeCase, badgeTracking] = CASE(r.badge.case);
  out.badgeRadius = RADIUS[r.badge.shape] as string;
  out.badgeBg = b === "solid" ? v("primary") : b === "outline" ? NONE : v("muted");
  out.badgeFg =
    b === "solid" ? v("primary-foreground") : b === "outline" ? v("text-muted") : v("text");
  out.badgeBorder = b === "solid" ? v("primary") : b === "outline" ? v("input") : v("border");
  out.badgeCase = badgeCase as string;
  out.badgeTracking = badgeTracking as string;
  const t = r.table;
  out.tableRowBorder = t.rows === "lines" ? v("border") : NONE;
  out.tableStripeBg = t.rows === "striped" ? v("muted") : NONE;
  out.tableHeaderBg = t.header === "muted" ? v("muted") : NONE;
  const [y, x] = SPACING[t.size] as string[];
  out.tableCellPaddingY = y as string;
  out.tableCellPaddingX = x as string;
  out.progressThickness = { thin: "2px", normal: "4px", thick: "8px" }[
    r.progress.thickness
  ] as string;
  out.progressRadius = RADIUS[r.progress.shape] as string;
  out.focusWidth = { thin: "1px", normal: "2px", thick: "3px" }[r.focus.width] as string;
  out.focusOffset = { none: "0", near: "2px", far: "4px" }[r.focus.offset] as string;
}

/** The component tokens of `recipe` (any part left out at its default), camelCase like every token. */
export function compileDesignSystem(recipe?: DesignRecipe | unknown): Record<string, string> {
  const r = fillRecipe(recipe);
  const out: Tokens = {};
  button(r.button, out);
  iconButton(r.iconButton, out);
  field(r.field, out);
  check(r.check, out);
  tabs(r.tabs, out);
  card(r.card, out);
  row(r.row, out);
  surfaces(r, out);
  marks(r, out);
  return out;
}

/** The endue design system's component tokens: what `tokens.css` declares (DH-07). */
export const componentTokens: Readonly<Record<string, string>> = compileDesignSystem();
