/**
 * Themes (desk.theme, like load-theme and defface): the scheme, contrast and motion the person asks
 * for, or the OS's when they say "system", and the contributed tokens for them. Themes of a scheme
 * layer over each other; high-contrast themes layer over the normal ones, so they only change a few.
 */
import { cssVariables, tokens } from "@endue-ai/ui";
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
}

export interface ThemeState {
  scheme: Scheme;
  contrast: Contrast;
  reducedMotion: boolean;
  /** The themes applied, lowest first; empty when only the built-in tokens apply. */
  themes: string[];
  tokens: Record<string, string>;
  /** The tokens as --desk-* custom properties. */
  variables: Record<string, string>;
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  scheme: "dark",
  contrast: "system",
  motion: "system",
};

export function resolveTheme(
  themes: PolicySet["themes"],
  settings: ThemeSettings,
  media: MediaPreferences,
): ThemeState {
  const scheme: Scheme =
    settings.scheme === "system" ? (media.dark ? "dark" : "light") : settings.scheme;
  const contrast: Contrast =
    settings.contrast === "system" ? (media.highContrast ? "high" : "normal") : settings.contrast;
  const reducedMotion =
    settings.motion === "system" ? media.reducedMotion : settings.motion === "reduce";
  const ofScheme = themes.filter((theme) => theme.scheme === scheme);
  const applied = [
    ...ofScheme.filter((theme) => (theme.contrast ?? "normal") === "normal"),
    ...(contrast === "high" ? ofScheme.filter((theme) => theme.contrast === "high") : []),
  ];
  const merged: Record<string, string> = {
    ...tokens,
    ...(scheme === "light" ? LIGHT_COLORS : {}),
    ...(contrast === "high" ? HIGH_CONTRAST[scheme] : {}),
  };
  for (const theme of applied) Object.assign(merged, theme.tokens);
  return {
    scheme,
    contrast,
    reducedMotion,
    themes: applied.map((theme) => theme.id),
    tokens: merged,
    variables: cssVariables(merged),
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
