/**
 * Themes (desk.theme, like load-theme and defface): the scheme, contrast and motion the person asks
 * for, or the OS's when they say "system", and the contributed tokens for them. Themes of a scheme
 * layer over each other; high-contrast themes layer over the normal ones, so they only change a few.
 * The result is every design token (@endue-ai/ui: the role colours and the scale), applied to the
 * shell's root and to each plugin frame as --desk-* custom properties. Over them all goes the theme
 * that desk.theme.active names (ADR 0056): an installed theme plugin, compiled for the scheme and gated
 * for contrast (@endue-ai/ui/theme); with none, the result is the layers alone. A see-through window
 * is made opaque, as the compositor cannot blur the windows under it.
 */
import type { ThemePackage } from "@endue-ai/bridge";
import { components, cssVariables, MOTION_TOKENS, tokens } from "@endue-ai/ui";
import {
  compileTheme,
  formatColor,
  type GateFix,
  gate,
  over,
  parseColor,
  type Rgba,
  type ThemeFontFace,
} from "@endue-ai/ui/theme";
import { HIGH_CONTRAST, LIGHT_COLORS } from "./core/colors";
import type { PolicySet } from "./policy";

export type Scheme = "light" | "dark";
export type Contrast = "normal" | "high";

/** What the OS prefers, from media queries. */
export interface MediaPreferences {
  dark: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
}

/** The theme settings, as desk.theme declares them. */
export interface ThemeSettings {
  scheme: "system" | Scheme;
  contrast: "system" | Contrast;
  motion: "system" | "reduce" | "full";
  /** The theme plugin in force; empty for the desk's own. */
  active?: string;
}

/** An installed theme plugin that desk.theme.active can name. */
export interface InstalledTheme {
  id: string;
  name: string;
  description?: string;
  theme: ThemePackage;
  /** The URL the desk serves one of its files at. */
  url(path: string): string;
}

export interface ThemeState {
  scheme: Scheme;
  /** The design system in force (ADR 0090): empty for the endue design system. */
  design?: string;
  contrast: Contrast;
  reducedMotion: boolean;
  /** The themes applied, lowest first; empty when only the built-in tokens apply. */
  themes: string[];
  /** The theme plugin in force, when desk.theme.active names an installed one. */
  active?: string;
  tokens: Record<string, string>;
  /** The tokens as --desk-* custom properties. */
  variables: Record<string, string>;
  /** The fonts the active theme brings. */
  fonts: ThemeFontFace[];
  /** What the contrast gate changed in the active theme. */
  fixes: GateFix[];
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  scheme: "dark",
  contrast: "system",
  motion: "system",
  active: "",
};

/**
 * `design` is the design system in force: its component tokens go over everything a theme sets, so
 * a theme's colours can never reach what the components are made of (DH-06).
 */
export function resolveTheme(
  themes: PolicySet["themes"],
  settings: ThemeSettings,
  media: MediaPreferences,
  installed: readonly InstalledTheme[] = [],
  design?: { id: string; tokens: Readonly<Record<string, string>> },
): ThemeState {
  const scheme: Scheme =
    settings.scheme === "system" ? (media.dark ? "dark" : "light") : settings.scheme;
  const contrast: Contrast =
    settings.contrast === "system" ? (media.highContrast ? "high" : "normal") : settings.contrast;
  const reducedMotion =
    settings.motion === "system" ? media.reducedMotion : settings.motion === "reduce";
  const chosen = settings.active ? installed.find((t) => t.id === settings.active) : undefined;
  const compiled = chosen ? compileTheme(chosen.theme, scheme, chosen.url) : undefined;
  // A theme with this scheme brings its own high contrast; the policies' layers would undo its palette.
  const own = compiled?.hasScheme === true;
  const ofScheme = themes.filter((theme) => theme.scheme === scheme);
  const applied = [
    ...ofScheme.filter((theme) => (theme.contrast ?? "normal") === "normal"),
    ...(contrast === "high" && !own ? ofScheme.filter((theme) => theme.contrast === "high") : []),
  ];
  const merged: Record<string, string> = {
    ...tokens,
    ...(scheme === "light" ? LIGHT_COLORS : {}),
    ...(contrast === "high" ? HIGH_CONTRAST[scheme] : {}),
  };
  for (const theme of applied) {
    const values = theme.tokens;
    Object.assign(merged, values);
    // Old themes had one brand role. Keep them effective after controls adopt semantic roles.
    if (values.accent !== undefined && values.primary === undefined) {
      for (const name of ["primary", "primaryHover", "primaryText", "ring"])
        if (values[name] === undefined) merged[name] = values.accent;
      if (values.primaryForeground === undefined)
        merged.primaryForeground = merged.background ?? tokens.background;
    } else if (values.primary !== undefined && values.accent === undefined) {
      merged.accent = values.primary;
    }
  }
  let result = merged;
  let fixes: GateFix[] = [];
  if (chosen && compiled) {
    result = { ...merged, ...compiled.tokens };
    if (compiled.tokens.primary !== undefined && compiled.tokens.accent === undefined)
      result.accent = compiled.tokens.primary;
    // Its palette is gated; without a variant for the scheme the palette is the desk's own.
    if (own) {
      if (contrast === "high") Object.assign(result, compiled.contrast);
      const gated = gate(result, { high: contrast === "high", fallback: merged });
      result = gated.tokens;
      fixes = gated.fixes;
    }
  }
  opaqueWindows(result);
  result = { ...result, ...(design?.tokens ?? components) };
  // The motion tokens are inline on each root, so a stylesheet rule could not zero them.
  if (reducedMotion) for (const name of MOTION_TOKENS) result[name] = "0ms";
  return {
    scheme,
    ...(design?.id ? { design: design.id } : {}),
    contrast,
    reducedMotion,
    themes: [...applied.map((theme) => theme.id), ...(chosen ? [chosen.id] : [])],
    ...(chosen ? { active: chosen.id } : {}),
    tokens: result,
    variables: cssVariables(result),
    fonts: compiled?.fonts ?? [],
    fixes,
  };
}

/**
 * A window shows nothing of the windows under it (ADR XXXX). The compositor draws each window over
 * the ones below and cannot blur them, so a see-through window (the material's opacity, ADR 0057, or
 * a card with alpha) showed their text sharp through its title bar. Its surface becomes the colour it
 * has over the theme's background, and the blur, with nothing left behind it to soften, goes.
 */
function opaqueWindows(out: Record<string, string>): void {
  const card = parseColor(out.card ?? "");
  const own = parseColor(out.surface ?? "");
  const opacity = out.surface === undefined ? 1 : Number(out.surfaceOpacity ?? 1);
  const pane: Rgba | undefined =
    own ??
    (card && [card[0], card[1], card[2], card[3] * (Number.isFinite(opacity) ? opacity : 1)]);
  if (!pane || pane[3] >= 1) return;
  const ground = over(parseColor(out.background ?? "") ?? [0, 0, 0, 1], [0, 0, 0, 1]);
  out.surface = formatColor(over(pane, ground));
  delete out.surfaceFilter;
}

/** Apply theme tokens as CSS custom properties on `root` (CSSOM, so a strict CSP still allows it). */
export function applyTheme(
  root: HTMLElement,
  theme: Readonly<Record<string, string>> = tokens,
): void {
  for (const [name, value] of Object.entries(cssVariables(theme))) {
    root.style.setProperty(name, value);
  }
}

/** Apply a resolved theme: its tokens, and data-scheme, data-contrast and data-motion. */
export function applyThemeState(root: HTMLElement, state: ThemeState): void {
  // Tokens an earlier theme added and this one lacks would otherwise linger.
  const stale = Array.from({ length: root.style.length }, (_, i) => root.style.item(i)).filter(
    (name) => name.startsWith("--desk-") && !(name in state.variables),
  );
  for (const name of stale) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(state.variables)) root.style.setProperty(name, value);
  root.dataset.scheme = state.scheme;
  root.dataset.contrast = state.contrast;
  root.dataset.motion = state.reducedMotion ? "reduce" : "full";
}

/** The OS's preferences now, and a way to hear when they change. */
export function mediaPreferences(win: Window): {
  read(): MediaPreferences;
  onChange(listener: () => void): () => void;
} {
  const query = (q: string) =>
    typeof win.matchMedia === "function" ? win.matchMedia(q) : undefined;
  const queries = [
    query("(prefers-color-scheme: dark)"),
    query("(prefers-contrast: more)"),
    query("(prefers-reduced-motion: reduce)"),
  ];
  return {
    read: () => ({
      dark: queries[0]?.matches ?? true,
      highContrast: queries[1]?.matches ?? false,
      reducedMotion: queries[2]?.matches ?? false,
    }),
    onChange: (listener) => {
      for (const q of queries) q?.addEventListener("change", listener);
      return () => {
        for (const q of queries) q?.removeEventListener("change", listener);
      };
    },
  };
}
