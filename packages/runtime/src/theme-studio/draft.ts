/**
 * The editor's draft: a copy of a theme block to change, the companions a base colour brings along
 * (a primary's hover, text, tints and ring; a status's text, tint and border), and the id a saved
 * draft gets. DOM-free.
 */
import type { ThemePackage, ThemeVariant } from "@endue-ai/bridge";
import { formatColor, parseColor, type Rgba } from "@endue-ai/ui/theme";

export type Scheme = "light" | "dark";

/** A deep copy of `theme` (or an empty theme with both schemes) to edit. */
export function draftFrom(theme?: ThemePackage): ThemePackage {
  const copy = theme ? (JSON.parse(JSON.stringify(theme)) as ThemePackage) : {};
  if (!copy.light && !copy.dark) {
    copy.light = {};
    copy.dark = {};
  }
  delete copy.origin;
  return copy;
}

/** The scheme's variant of a draft, made when missing. */
export function variantOf(draft: ThemePackage, scheme: Scheme): ThemeVariant {
  draft[scheme] ??= {};
  return draft[scheme] as ThemeVariant;
}

const mix = (a: Rgba, b: Rgba, t: number): Rgba => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  1,
];
const alpha = ([r, g, b]: Rgba, a: number): string => formatColor([r, g, b, a]);

/** What changes with a base colour: its companions, derived as desk.theme derives them. */
export function companions(name: string, value: string, scheme: Scheme): Record<string, string> {
  const c = parseColor(value);
  if (!c) return {};
  if (name === "primary") {
    const toward: Rgba = scheme === "dark" ? [255, 255, 255, 1] : [0, 0, 0, 1];
    return {
      primaryHover: formatColor(mix(c, toward, 0.15)),
      primaryText: formatColor(c),
      primarySubtle: alpha(c, 0.08),
      primarySoft: alpha(c, 0.12),
      primaryBorder: alpha(c, 0.34),
      ring: formatColor(c),
      accent: formatColor(c),
    };
  }
  if (["success", "warning", "danger", "info"].includes(name)) {
    return {
      [`${name}Text`]: formatColor(c),
      [`${name}Soft`]: alpha(c, 0.16),
      [`${name}Border`]: alpha(c, 0.4),
    };
  }
  return {};
}

/** Set a palette colour in the draft, with its companions. */
export function setColor(draft: ThemePackage, scheme: Scheme, name: string, value: string): void {
  const variant = variantOf(draft, scheme);
  variant.colors = { ...variant.colors, [name]: value, ...companions(name, value, scheme) };
}

/** A name as a plugin id segment: lowercase letters, digits and dashes. */
export function slug(name: string): string {
  const s = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return /^[a-z]/.test(s) ? s : `theme${s ? `-${s}` : ""}`;
}

/** The id a draft named `name` is saved under: `local.<slug>`, numbered when another theme has it. */
export function localId(name: string, taken: readonly string[], keep?: string): string {
  const base = `local.${slug(name)}`;
  if (base === keep || !taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (id === keep || !taken.includes(id)) return id;
  }
}
