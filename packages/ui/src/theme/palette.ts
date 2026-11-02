/**
 * A starting palette from a few colours, a brand's (docs/ko/theme-requirements.md TS-09). The most
 * saturated is the primary; the lightest (light scheme) or darkest (dark scheme) tints the surfaces;
 * the text, the inks on fills and the status colours are then moved by the theme gate, so the palette
 * passes it as it is. The primary keeps the brand colour when it stands 3:1 from the grounds, the
 * ratio the gate asks of the focus ring it doubles as; otherwise only its lightness moves. DOM-free.
 */
import { colors as desk } from "../tokens";
import { contrast, formatColor, fromOklch, parseColor, type Rgba, toOklch } from "./color";
import type { Scheme } from "./compile";
import { type GateFix, gate, reach, reachAll } from "./gate";

export interface BrandPalette {
  /** Role colours for the scheme's `colors` block: every token the gate measures, gated. */
  colors: Record<string, string>;
  /** The brand colour: the most saturated of those given (the one farthest from the ground when none is). */
  brand: string;
  /** What the gate moved while the palette was built. */
  fixes: GateFix[];
}

const STATUSES = ["success", "warning", "danger", "info"] as const;
/** Chroma under which a colour reads as grey: no brand colour among such. */
const GREY = 0.04;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const oklch = (L: number, C: number, H: number): Rgba => [
  ...(fromOklch(clamp(L, 0, 1), C, H).map(Math.round) as [number, number, number]),
  1,
];
const hex = (c: Rgba) => formatColor([c[0], c[1], c[2], 1]);
const tint = (c: Rgba, alpha: number) => formatColor([c[0], c[1], c[2], alpha]);
const mix = (a: Rgba, b: Rgba, t: number): Rgba => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
  1,
];
const WHITE: Rgba = [255, 255, 255, 1];
const BLACK: Rgba = [0, 0, 0, 1];

/** Surfaces, structure and inks of one hue, the ground colour's, at the scheme's lightness. */
function grounds(ground: Rgba, scheme: Scheme): Record<string, Rgba> {
  const [l, chroma, h] = toOklch(ground);
  if (scheme === "light") {
    const c = Math.min(chroma, 0.03);
    const L = clamp(l, 0.955, 0.985);
    const card = oklch(Math.min(1, L + 0.015), c / 2, h);
    return {
      background: oklch(L, c, h),
      card,
      muted: oklch(L - 0.03, c, h),
      popover: card,
      hover: oklch(L - 0.06, c, h),
      border: oklch(L - 0.12, c, h),
      input: oklch(0.6, c, h),
      text: oklch(0.24, Math.min(0.04, c * 2), h),
      textMuted: oklch(0.48, Math.min(0.04, c * 2), h),
      tooltip: oklch(0.3, Math.min(0.04, c * 2), h),
      tooltipText: oklch(0.97, c / 2, h),
    };
  }
  const c = Math.min(chroma, 0.035);
  const L = clamp(l, 0.15, 0.21);
  return {
    background: oklch(L, c, h),
    card: oklch(L + 0.035, c, h),
    muted: oklch(L + 0.055, c, h),
    popover: oklch(L + 0.085, c, h),
    hover: oklch(L + 0.125, c, h),
    border: oklch(L + 0.12, c, h),
    input: oklch(0.6, c, h),
    text: oklch(0.96, c * 0.4, h),
    textMuted: oklch(0.76, c * 0.6, h),
    tooltip: oklch(L + 0.17, c, h),
    tooltipText: oklch(0.96, c * 0.4, h),
  };
}

/** A palette for `scheme` from `colors` (CSS colours, the most covering first). */
export function paletteFrom(colors: readonly string[], scheme: Scheme): BrandPalette {
  const parsed = colors
    .map((c) => parseColor(c))
    .filter((c): c is Rgba => c !== undefined)
    .map((c): Rgba => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 1]);
  const list = parsed.length > 0 ? parsed : [parseColor(desk.primary) ?? WHITE];
  const lightness = (c: Rgba) => toOklch(c)[0];
  const pick = (better: (a: Rgba, b: Rgba) => boolean) =>
    list.reduce((best, c) => (better(c, best) ? c : best));
  const g = grounds(
    pick((a, b) =>
      scheme === "light" ? lightness(a) > lightness(b) : lightness(a) < lightness(b),
    ),
    scheme,
  );
  const background = g.background ?? BLACK;
  const card = g.card ?? background;

  const chroma = (c: Rgba) => toOklch(c)[1];
  const saturated = pick((a, b) => chroma(a) > chroma(b));
  const brand =
    chroma(saturated) >= GREY
      ? saturated
      : pick((a, b) => contrast(a, background) > contrast(b, background));
  const stands = (c: Rgba) => Math.min(contrast(c, background), contrast(c, card)) / 3;
  const ok = (c: Rgba) => stands(c) >= 1 - 1e-9;
  const primary = ok(brand) ? brand : reachAll(brand, ok, stands);

  // The ink on a fill: the scheme's dark or light ink, whichever reads better; the gate tunes it.
  const darkInk = (scheme === "dark" ? g.background : g.text) ?? BLACK;
  const lightInk = (scheme === "dark" ? g.text : g.card) ?? WHITE;
  const inkOn = (fill: Rgba) =>
    contrast(darkInk, fill) >= contrast(lightInk, fill) ? darkInk : lightInk;
  const ink = inkOn(primary);

  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(g)) out[name] = hex(value);
  Object.assign(out, {
    primary: hex(primary),
    primaryForeground: hex(ink),
    // Hover moves away from the ink, so the ink reads at least as well on it.
    primaryHover: hex(mix(primary, ink === darkInk ? WHITE : BLACK, 0.15)),
    primaryText: hex(primary),
    primarySubtle: tint(primary, 0.08),
    primarySoft: tint(primary, 0.12),
    primaryBorder: tint(primary, 0.34),
    ring: hex(primary),
    accent: hex(primary),
  });
  for (const s of STATUSES) {
    const base = parseColor(desk[s]) ?? BLACK;
    const fill = contrast(base, card) >= 3 ? base : reach(base, card, 3);
    Object.assign(out, {
      [s]: hex(fill),
      [`${s}Foreground`]: hex(inkOn(fill)),
      [`${s}Text`]: hex(fill),
      [`${s}Soft`]: tint(fill, 0.16),
      [`${s}Border`]: tint(fill, 0.4),
    });
  }
  const { tokens, fixes } = gate(out);
  return { colors: tokens, brand: hex(brand), fixes };
}
