/**
 * A theme the brain proposed, cleaned before anything shows it: only the theme block's own keys, token
 * maps through cleanTokens, presets the desk knows, numbers clamped to their ranges, colours that are
 * colours, and no files (fonts, backdrop images) or origin, which Apply sets. A brand or status colour
 * brings the companions the brain left out, as the editor derives them. The gate then runs on it when
 * the desk previews it (RuntimeThemes.previewDraft), as on every theme. DOM-free.
 */
import type { ThemePackage, ThemeVariant } from "@endue-ai/bridge";
import { cleanTokens, DENSITY, MOTION, RADIUS, RANGES, SHADOW } from "@endue-ai/ui/theme";
import { companions, type Scheme } from "./draft";

/** propose_theme's arguments, cleaned: the name ("" when it gave none), a line about it, the block. */
export interface Proposal {
  name: string;
  description: string;
  theme: ThemePackage;
}

type Fields = Record<string, unknown>;

const COLOR =
  /^(#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(rgba?|hsla?|oklch)\([0-9a-zA-Z.,%/ +-]*\))$/;
const STACK = /^[A-Za-z0-9 "',._-]{1,300}$/;
const TAG = /^[a-z0-9][a-z0-9-]{0,31}$/;

const fields = (v: unknown): Fields =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Fields) : {};
const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const color = (v: unknown) =>
  typeof v === "string" && COLOR.test(v.trim()) ? v.trim() : undefined;
const colors = (v: unknown, max: number) =>
  Array.isArray(v)
    ? v
        .map(color)
        .filter((c): c is string => c !== undefined)
        .slice(0, max)
    : [];
const within = (v: unknown, [lo, hi]: readonly [number, number], whole = false) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.min(hi, Math.max(lo, v));
  return whole ? Math.round(n) : n;
};
const preset = <K extends string>(v: unknown, known: Record<K, unknown>): K | undefined =>
  typeof v === "string" && Object.hasOwn(known, v) ? (v as K) : undefined;
/** `o` without its undefined fields, or undefined when nothing is left. */
function some<T extends object>(o: T): T | undefined {
  const kept = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return Object.keys(kept).length > 0 ? (kept as T) : undefined;
}
const tokens = (v: unknown) => {
  const clean = cleanTokens(v);
  return Object.keys(clean).length > 0 ? clean : undefined;
};
/** A palette with the companions of its brand and status colours it lacks (a hover, tints, a ring). */
const palette = (v: unknown, scheme: Scheme) => {
  const own = tokens(v);
  if (!own) return undefined;
  const derived: Record<string, string> = {};
  for (const name of ["primary", "success", "warning", "danger", "info"]) {
    const base = own[name];
    if (base) Object.assign(derived, companions(name, base, scheme));
  }
  return { ...derived, ...own };
};

function variant(input: unknown, scheme: Scheme): ThemeVariant | undefined {
  const v = fields(input);
  const m = fields(v.material);
  const b = fields(v.backdrop);
  const gradient = colors(b.gradient, 4);
  const ansi = colors(fields(v.terminal).ansi, 16);
  return some<ThemeVariant>({
    colors: palette(v.colors, scheme),
    contrast: tokens(v.contrast),
    material: some({
      opacity: within(m.opacity, RANGES.opacity),
      blur: within(m.blur, RANGES.blur, true),
      noise: within(m.noise, RANGES.noise),
      border: within(m.border, RANGES.border, true),
      shadow: preset(m.shadow, SHADOW),
    }),
    backdrop: some({
      color: color(b.color),
      gradient: gradient.length >= 2 ? gradient : undefined,
      angle: within(b.angle, RANGES.angle, true),
      glow: color(b.glow),
    }),
    terminal: ansi.length === 16 ? { ansi } : undefined,
  });
}

/** The proposal in propose_theme's arguments, or undefined when they hold no theme for any scheme. */
export function cleanProposal(structured: unknown): Proposal | undefined {
  const args = fields(structured);
  const t = fields(args.theme);
  const type = fields(t.type);
  const sans = typeof type.sans === "string" && STACK.test(type.sans) ? type.sans : undefined;
  const mono = typeof type.mono === "string" && STACK.test(type.mono) ? type.mono : undefined;
  const tags = Array.isArray(t.tags)
    ? [...new Set(t.tags.filter((tag): tag is string => typeof tag === "string" && TAG.test(tag)))]
    : [];
  const preview = colors(t.preview, 5);
  const theme = some<ThemePackage>({
    author: text(t.author, 120) || undefined,
    license: text(t.license, 120) || undefined,
    tags: tags.length > 0 ? tags.slice(0, 12) : undefined,
    preview: preview.length > 0 ? preview : undefined,
    type: some({
      sans,
      mono,
      scale: within(type.scale, RANGES.scale),
      tracking: within(type.tracking, RANGES.tracking),
    }),
    shape: some({
      radius: preset(fields(t.shape).radius, RADIUS),
      density: preset(fields(t.shape).density, DENSITY),
    }),
    motion: some({ personality: preset(fields(t.motion).personality, MOTION) }),
    light: variant(t.light, "light"),
    dark: variant(t.dark, "dark"),
  });
  if (!theme?.light && !theme?.dark) return undefined;
  return { name: text(args.name, 80), description: text(args.description, 400), theme };
}
