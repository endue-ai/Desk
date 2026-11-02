/**
 * Themes (desk.theme, like load-theme and defface): the scheme, contrast and motion the person asks
 * for, or the OS's when they say "system", and the contributed tokens for them. Themes of a scheme
 * layer over each other; high-contrast themes layer over the normal ones, so they only change a few.
 * The result is every design token (@endue-ai/ui: the role colours and the scale), applied to the
 * shell's root and to each plugin frame as --desk-* custom properties. Over them all goes the theme
 * that desk.theme.active names (ADR 0056): an installed theme plugin, compiled for the scheme and gated
 * for contrast (@endue-ai/ui/theme); with none, the result is the layers alone.
 */
import type { ThemePackage } from "@endue-ai/bridge";
import { cssVariables, MOTION_TOKENS, tokens } from "@endue-ai/ui";
import { compileTheme, type GateFix, gate, type ThemeFontFace } from "@endue-ai/ui/theme";
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

export function resolveTheme(
  themes: PolicySet["themes"],
  settings: ThemeSettings,
  media: MediaPreferences,
  installed: readonly InstalledTheme[] = [],
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
  const merged: Record<string, string> = { ...tokens };
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
  // The motion tokens are inline on each root, so a stylesheet rule could not zero them.
  if (reducedMotion) for (const name of MOTION_TOKENS) result[name] = "0ms";
  return {
    scheme,
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
