// The database plugin's stylesheets read as rules, and the colours they paint worked out in a
// scheme, for the contrast test (contrast.test.ts, NF-05). Every sheet under ui/ is read, the
// feature folders' too, so a sheet a new feature adds is measured without a change here.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { parseColor, type Rgba } from "../../../packages/ui/src/theme/index";
import { propertyOf, tokens } from "../../../packages/ui/src/tokens";

export const ROOT = join(import.meta.dirname, "../../..");
const UI = join(ROOT, "plugins/database/ui");

export interface Rule {
  /** The sheet, from the repository's root. */
  file: string;
  /** The selector list, its whitespace folded. */
  selector: string;
  decls: Array<[property: string, value: string]>;
}

/** Every stylesheet of the plugin's page, vendored code aside, from the repository's root. */
export function sheets(dir = UI): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "vendor" ? [] : sheets(path);
      return name.endsWith(".css") ? [relative(ROOT, path).split(sep).join("/")] : [];
    });
}

/** The index of the brace that closes the one at `open`. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  throw new Error(`unclosed block at ${open}`);
}

/** `text` split at `sep` where no parenthesis is open. */
export function split(text: string, at: string | RegExp): string[] {
  const out = [""];
  let depth = 0;
  for (const ch of text) {
    depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    if (depth === 0 && (typeof at === "string" ? ch === at : at.test(ch))) out.push("");
    else out[out.length - 1] += ch;
  }
  return out.map((part) => part.trim()).filter(Boolean);
}

/** A sheet's style rules, also those inside @media and @supports; @import and @keyframes are dropped. */
export function parseCss(css: string, file: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  const walk = (from: number, to: number) => {
    let i = from;
    while (i < to) {
      const open = text.indexOf("{", i);
      const semi = text.indexOf(";", i);
      if (semi !== -1 && semi < to && (open === -1 || semi < open)) {
        i = semi + 1; // an @import or @charset
        continue;
      }
      if (open === -1 || open >= to) break;
      const close = closing(text, open);
      const prelude = text.slice(i, open).trim().replace(/\s+/g, " ");
      if (/^@(media|supports|layer|container)\b/.test(prelude)) walk(open + 1, close);
      else if (!prelude.startsWith("@"))
        out.push({
          file,
          selector: prelude,
          decls: split(text.slice(open + 1, close), ";").flatMap((decl) => {
            const colon = decl.indexOf(":");
            if (colon < 0) return [];
            const value = decl.slice(colon + 1).replace(/!important\s*$/, "");
            return [[decl.slice(0, colon).trim().toLowerCase(), value.trim()] as [string, string]];
          }),
        });
      i = close + 1;
    }
  };
  walk(0, text.length);
  return out;
}

/** Every rule of every sheet of the plugin. */
export function pluginRules(): Rule[] {
  return sheets().flatMap((file) => parseCss(readFileSync(join(ROOT, file), "utf8"), file));
}

/** The --desk-* tokens of a scheme as the desk applies them: the built-in set, then plugins/theme's. */
export function scheme(name: "light" | "dark"): Record<string, string> {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "plugins/theme/plugin.json"), "utf8"),
  ) as PluginManifest;
  const layer = manifest.contributes?.themes?.find(
    (t) => t.scheme === name && (t.contrast ?? "normal") === "normal",
  )?.tokens;
  const merged: Record<string, string> = { ...tokens, ...layer };
  return Object.fromEntries(Object.entries(merged).map(([k, v]) => [propertyOf(k), v]));
}

/** A colour the sheets paint, and the custom properties chosen on the way (`--tag: var(--db-staging)`). */
export interface Paint {
  rgba: Rgba;
  via: string[];
}

/** The surfaces: a page, a panel, a sunken track, a floating layer, the hover and selected row, a tint. */
const SURFACE =
  /^--desk-(background|card|muted|popover|hover|tooltip|scrim|surface|code-surface|[a-z]+-soft|primary-subtle)$/;

export class Palette {
  /** Each custom property the plugin's rules set, with every value it is given. */
  readonly own = new Map<string, string[]>();

  constructor(
    readonly desk: Record<string, string>,
    rules: Rule[],
  ) {
    for (const rule of rules)
      for (const [prop, value] of rule.decls)
        if (prop.startsWith("--")) this.own.set(prop, [...(this.own.get(prop) ?? []), value]);
  }

  /** What `name` stands for: the plugin's values first (they win where they are set), then the desk's. */
  private values(name: string): string[] | undefined {
    const own = this.own.get(name);
    if (own) return own;
    const desk = this.desk[name];
    return desk === undefined ? undefined : [desk];
  }

  /** The text a value stands for once its custom properties are put in, one per way they are set. */
  expand(value: string, via: string[] = [], depth = 0): Array<{ text: string; via: string[] }> {
    if (depth > 12) throw new Error(`custom properties loop in ${value}`);
    const ref = /var\(\s*(--[a-z0-9-]+)\s*(?:,([^()]*(?:\([^()]*\))*[^()]*))?\)/i.exec(value);
    if (!ref) return [{ text: value, via }];
    const [whole, name = "", fallback] = ref;
    const choices = this.values(name) ?? (fallback === undefined ? [] : [fallback.trim()]);
    if (choices.length === 0) throw new Error(`${name} is not set`);
    return choices.flatMap((choice) => {
      const step = this.own.has(name) ? [...via, `${name}: ${choice}`] : via;
      return this.expand(value.replace(whole, choice), step, depth + 1);
    });
  }

  /** What a colour expression paints; undefined when it is not a colour (a length, `none`). */
  paints(value: string): Paint[] | undefined {
    const out: Paint[] = [];
    for (const { text, via } of this.expand(value)) {
      const rgba = colour(text);
      if (!rgba) return undefined;
      out.push({ rgba, via });
    }
    return out;
  }

  /** Whether a colour expression is a surface or a tint of one: what text and marks sit on. */
  surface(value: string): boolean {
    const text = value.trim();
    if (text === "transparent") return true;
    const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(text)?.[1];
    if (ref)
      return SURFACE.test(ref) || (this.own.get(ref)?.every((v) => this.surface(v)) ?? false);
    const mix = /^color-mix\(\s*in srgb\s*,(.*)\)$/i.exec(text)?.[1];
    if (mix) return split(mix, ",").some((part) => this.surface(part.replace(/\s+[\d.]+%$/, "")));
    return false;
  }
}

/** A colour a declaration paints, as written (`var(--desk-warning)`), and what it paints. */
export interface Painted {
  expr: string;
  paints: Paint[];
}

const SHAPE =
  /^(-?[\d.]+(px|em|rem|%)?|inset|solid|dashed|dotted|double|wavy|underline|overline|line-through|none|center|top|bottom|left|right|repeat|no-repeat|repeat-x|repeat-y|\/|auto|cover|contain)$/i;

/**
 * The colours a declaration paints, with what it is written as: each part of a shorthand that is a
 * colour, each stop of a gradient, each shadow drawn without blur (a bar or a ring; a blurred one is
 * elevation, the shadow tokens). Undefined when a part can be neither placed nor worked out.
 */
export function painted(prop: string, value: string, palette: Palette): Painted[] | undefined {
  const text = value.trim();
  if (/^(none|inherit|initial|unset|currentcolor|0)$/i.test(text)) return [];
  if (prop === "box-shadow" || prop === "text-shadow") {
    const out: Painted[] = [];
    for (const shadow of split(text, ",")) {
      if (/^var\([^()]*\)$/.test(shadow)) {
        // A token for whole shadows (--desk-shadow-md): elevation when every one of them blurs.
        const blurs = palette
          .expand(shadow)
          .every(({ text: t }) => split(t, ",").every((s) => blur(s) > 0));
        if (blurs) continue;
      } else if (blur(shadow) > 0) continue;
      for (const part of split(shadow, /\s/))
        if (!SHAPE.test(part)) out.push(...colours(part, palette));
    }
    return out;
  }
  const out: Painted[] = [];
  for (const part of split(text, /\s/)) {
    if (SHAPE.test(part) || /^url\(/.test(part)) continue;
    const gradient = /^(?:repeating-)?(?:linear|radial|conic)-gradient\((.*)\)$/.exec(part)?.[1];
    if (gradient) {
      for (const stop of split(gradient, ",")) {
        const [first = ""] = split(stop, /\s/);
        if (!/^(to|from|at|circle|ellipse|[\d.-]+(deg|turn|rad))\b/.test(first))
          out.push(...colours(first, palette));
      }
      continue;
    }
    out.push(...colours(part, palette));
  }
  return out;
}

/** A shadow's blur radius: its third length. */
function blur(shadow: string): number {
  const lengths = split(shadow, /\s/).filter((p) => /^-?[\d.]+(px|em|rem)?$/.test(p));
  return Number.parseFloat(lengths[2] ?? "0") || 0;
}

/** A part as a colour, or nothing when it stands for something else (a width's var()). */
function colours(part: string, palette: Palette): Painted[] {
  const paints = palette.paints(part);
  if (paints) return [{ expr: part, paints }];
  if (/^(#|rgb|hsl|oklch|color-mix)/i.test(part)) throw new Error(`cannot work out ${part}`);
  return [];
}

/** A colour from a plain value: a literal, `transparent`, or `color-mix(in srgb, …)` of those. */
function colour(text: string): Rgba | undefined {
  const value = text.trim();
  const mix = /^color-mix\(\s*in srgb\s*,(.*)\)$/i.exec(value)?.[1];
  if (!mix) return parseColor(value);
  const [a, b] = split(mix, ",").map((part) => {
    const m = /^(.*?)\s+([\d.]+)%$/.exec(part);
    return { rgba: colour(m ? (m[1] ?? "") : part), share: m ? Number(m[2]) / 100 : undefined };
  });
  const [x, y] = [a?.rgba, b?.rgba];
  if (!x || !y) return undefined;
  const p = a?.share ?? (b?.share === undefined ? 0.5 : 1 - b.share);
  const q = b?.share ?? 1 - p;
  // Mixed with premultiplied alpha, as CSS does: a share of `transparent` only thins the other.
  const alpha = x[3] * p + y[3] * q;
  if (alpha === 0) return [0, 0, 0, 0];
  const ch = (i: number) => ((x[i] ?? 0) * x[3] * p + (y[i] ?? 0) * y[3] * q) / alpha;
  return [ch(0), ch(1), ch(2), alpha];
}
