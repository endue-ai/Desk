/**
 * Compile a theme block (specs/plugin/v0/theme.schema.json, ADR 0057) for one scheme into the desk's
 * tokens: the shared type, shape and motion layers always, the scheme's palette, material, backdrop
 * and terminal colours when the theme has that scheme. Values outside the schema's bounds (a theme
 * the brain wrote, say) are clamped or dropped here, so nothing unsafe reaches a stylesheet.
 */
import type { ThemePackage, ThemeVariant } from "@endue-ai/bridge";
import { colors, scale } from "../tokens";
import { DENSITY, MOTION, RADIUS, RANGES, SHADOW } from "./presets";

export type Scheme = "light" | "dark";

/** A font the theme brings, with its URL resolved. */
export interface ThemeFontFace {
  family: string;
  url: string;
  weight?: string;
  style?: string;
}

export interface CompiledTheme {
  /** What the theme sets for the scheme: shared layers, and the variant's when it has one. */
  tokens: Record<string, string>;
  /** Its high-contrast palette for the scheme (empty when the desk must derive one). */
  contrast: Record<string, string>;
  fonts: ThemeFontFace[];
  /** Colours for a gallery card. */
  preview: string[];
  /** Whether the theme has a variant for the scheme. */
  hasScheme: boolean;
}

const NAME = /^[a-z][a-zA-Z0-9]{0,63}$/;
const VALUE = /^[^;{}<>\\]{1,200}$/;
const COLOR =
  /^(#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(rgba?|hsla?|oklch)\([0-9a-zA-Z.,%/ +-]*\))$/;
const STACK = /^[A-Za-z0-9 "',._-]{1,300}$/;
const ASSET = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._/-]{1,200}$/;

const color = (value: unknown): string | undefined =>
  typeof value === "string" && COLOR.test(value.trim()) ? value.trim() : undefined;
const bounded = (value: unknown, [lo, hi]: readonly [number, number]): number | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(hi, Math.max(lo, value))
    : undefined;
const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/** A token map with only safe names and values. */
export function cleanTokens(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (!NAME.test(name) || typeof value !== "string") continue;
    const v = value.trim();
    if (VALUE.test(v) && !/url\(/i.test(v) && !/expression\(/i.test(v)) out[name] = v;
  }
  return out;
}

function shared(theme: ThemePackage, out: Record<string, string>) {
  const type = theme.type;
  if (type?.sans && STACK.test(type.sans)) out.fontSans = type.sans;
  if (type?.mono && STACK.test(type.mono)) out.fontMono = type.mono;
  const factor = bounded(type?.scale, RANGES.scale);
  if (factor !== undefined && factor !== 1) {
    for (const [name, value] of Object.entries(scale)) {
      if (/^text\d?[A-Z0-9]/.test(name) && value.endsWith("px"))
        out[name] = `${Math.round(Number.parseFloat(value) * factor)}px`;
    }
  }
  const tracking = bounded(type?.tracking, RANGES.tracking);
  if (tracking !== undefined) out.tracking = `${tracking}em`;
  const radius = theme.shape?.radius;
  if (radius && radius in RADIUS) Object.assign(out, RADIUS[radius]);
  const density = theme.shape?.density;
  if (density && density in DENSITY) Object.assign(out, DENSITY[density]);
  const personality = theme.motion?.personality;
  if (personality && personality in MOTION) Object.assign(out, MOTION[personality]);
}

function variant(v: ThemeVariant, out: Record<string, string>, url: (path: string) => string) {
  const m = v.material;
  if (m?.shadow && m.shadow in SHADOW) Object.assign(out, SHADOW[m.shadow]);
  Object.assign(out, cleanTokens(v.colors));
  const opacity = bounded(m?.opacity, RANGES.opacity);
  if (opacity !== undefined) out.surfaceOpacity = String(opacity);
  const blur = bounded(m?.blur, RANGES.blur);
  if (blur !== undefined) out.blur = px(blur);
  const noise = bounded(m?.noise, RANGES.noise);
  if (noise !== undefined) out.noise = String(noise);
  const border = bounded(m?.border, RANGES.border);
  if (border !== undefined) out.borderWidth = px(border);
  // Shell chrome reads --desk-surface (falling back to the card) and --desk-surface-filter.
  if (opacity !== undefined && opacity < 1) {
    const card = color(out.card) ?? color(colors.card) ?? colors.card;
    out.surface = `color-mix(in srgb, ${card} ${Math.round(opacity * 100)}%, transparent)`;
  }
  if (blur !== undefined && blur > 0) out.surfaceFilter = `blur(${px(blur)}) saturate(1.2)`;

  const b = v.backdrop;
  const image = typeof b?.image === "string" && ASSET.test(b.image) ? b.image : undefined;
  const stops = (b?.gradient ?? []).map(color).filter((c): c is string => c !== undefined);
  const angle = bounded(b?.angle, RANGES.angle) ?? 180;
  const solid = color(b?.color);
  if (image) {
    out.backdrop = `url("${url(image).replace(/["\\]/g, "")}")`;
    out.backdropSize = b?.fit === "tile" ? "auto" : "cover";
    out.backdropRepeat = b?.fit === "tile" ? "repeat" : "no-repeat";
  } else if (stops.length >= 2) {
    out.backdrop = `linear-gradient(${angle}deg, ${stops.slice(0, 4).join(", ")})`;
  } else if (solid) {
    out.backdrop = `linear-gradient(${solid}, ${solid})`;
  }
  const glow = color(b?.glow);
  if (glow) out.glow = glow;

  const ansi = v.terminal?.ansi ?? [];
  if (ansi.length === 16) {
    ansi.forEach((c, i) => {
      const value = color(c);
      if (value) out[`ansi${i}`] = value;
    });
  }
}

/** Compile `theme` for `scheme`. `url` turns an asset path into the URL the desk serves it at. */
export function compileTheme(
  theme: ThemePackage,
  scheme: Scheme,
  url: (path: string) => string = (path) => path,
): CompiledTheme {
  const tokens: Record<string, string> = {};
  shared(theme, tokens);
  const own = theme[scheme];
  if (own) variant(own, tokens, url);
  const fonts: ThemeFontFace[] = (theme.type?.fonts ?? [])
    .filter(
      (f) =>
        /^[A-Za-z0-9 ._-]{1,80}$/.test(f.family) && ASSET.test(f.src) && f.src.endsWith(".woff2"),
    )
    .map((f) => ({
      family: f.family,
      url: url(f.src),
      ...(f.weight ? { weight: f.weight } : {}),
      ...(f.style ? { style: f.style } : {}),
    }));
  const given = (theme.preview ?? []).map(color).filter((c): c is string => c !== undefined);
  const palette = own?.colors ?? theme.light?.colors ?? theme.dark?.colors ?? {};
  const picked = ["background", "card", "text", "primary"]
    .map((name) => color(palette[name]))
    .filter((c): c is string => c !== undefined);
  return {
    tokens,
    contrast: own ? cleanTokens(own.contrast) : {},
    fonts,
    preview: (given.length > 0 ? given : picked).slice(0, 5),
    hasScheme: own !== undefined,
  };
}
