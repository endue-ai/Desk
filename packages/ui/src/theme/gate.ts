/**
 * The theme gate (docs/ko/theme-requirements.md TH-07): every theme the desk applies passes the same
 * contrast pairs. A failing foreground is fixed by moving only its OKLCH lightness, as little as
 * reaches the ratio, so hue and chroma (the theme's character) stay; grounds are never changed. Under
 * high contrast the same pairs ask 7:1 of key text and 4.5:1 of borders and fills, so a theme's own
 * colours become its high-contrast palette.
 */
import { contrast, formatColor, fromOklch, over, parseColor, type Rgba, toOklch } from "./color";

const SURFACES = ["background", "card", "muted", "popover", "hover"];
const STATUSES = ["success", "warning", "danger", "info"];

/** [text token, ground token, a translucent layer over the ground?]: 4.5:1, 7:1 for key text in high contrast. */
export const TEXT_PAIRS: ReadonlyArray<readonly [string, string, string?]> = [
  ...SURFACES.flatMap((s) => [["text", s] as const, ["textMuted", s] as const]),
  ["text", "card", "primarySoft"],
  ["primaryText", "background"],
  ["primaryText", "card"],
  ["primaryText", "card", "primarySoft"],
  ["primaryForeground", "primary"],
  ["primaryForeground", "primaryHover"],
  ["tooltipText", "tooltip"],
  ...STATUSES.flatMap((s) => [
    [`${s}Foreground`, s] as const,
    [`${s}Text`, "card"] as const,
    [`${s}Text`, "background"] as const,
    [`${s}Text`, "card", `${s}Soft`] as const,
    ["text", "card", `${s}Soft`] as const,
  ]),
];

/** [border or fill token, ground token]: 3:1, 4.5:1 in high contrast. */
export const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["input", "background"],
  ["input", "card"],
  ["ring", "background"],
  ["ring", "card"],
  ...STATUSES.map((s) => [s, "card"] as const),
];

/** Text that must reach 7:1 under high contrast (on the surfaces), and its pair on the brand fill. */
const KEY_TEXT = new Set(["text", "textMuted", "primaryText"]);

export interface GateFix {
  token: string;
  from: string;
  to: string;
  /** The ground it was measured on (and the layer over it). */
  against: string;
  ratio: number;
}

export interface Gated {
  tokens: Record<string, string>;
  fixes: GateFix[];
}

export interface GateOptions {
  /** Ask the high-contrast ratios. */
  high?: boolean;
  /** Values for tokens that are missing or not a colour this gate reads: the desk's own. */
  fallback?: Readonly<Record<string, string>>;
}

interface Need {
  ground: string;
  layer?: string;
  ratio: number;
}

/** What each foreground must reach, fills and borders first (some are grounds of text after). */
function needs(high: boolean): Array<[string, Need[]]> {
  const byToken = new Map<string, Need[]>();
  const add = (fg: string, need: Need) => {
    const list = byToken.get(fg) ?? [];
    if (
      !list.some((n) => n.ground === need.ground && n.layer === need.layer && n.ratio >= need.ratio)
    )
      list.push(need);
    byToken.set(fg, list);
  };
  for (const [fg, ground] of NON_TEXT_PAIRS) add(fg, { ground, ratio: high ? 4.5 : 3 });
  for (const [fg, ground, layer] of TEXT_PAIRS) {
    const brand = fg === "primaryForeground" && ground === "primary";
    add(fg, { ground, ...(layer ? { layer } : {}), ratio: high && brand ? 7 : 4.5 });
  }
  if (high)
    for (const ink of KEY_TEXT) for (const ground of SURFACES) add(ink, { ground, ratio: 7 });
  const fills = new Set(NON_TEXT_PAIRS.map(([fg]) => fg));
  return [...byToken].sort(([a], [b]) => Number(fills.has(b)) - Number(fills.has(a)));
}

/** Check every pair and fix what fails. Returns new tokens and what changed. */
export function gate(input: Readonly<Record<string, string>>, options: GateOptions = {}): Gated {
  const tokens: Record<string, string> = { ...input };
  const fixes: GateFix[] = [];
  const read = (name: string): Rgba | undefined => {
    const own = tokens[name] === undefined ? undefined : parseColor(tokens[name]);
    if (own) return own;
    const fallback = options.fallback?.[name];
    const parsed = fallback === undefined ? undefined : parseColor(fallback);
    if (parsed && fallback !== undefined && tokens[name] !== undefined) {
      fixes.push({ token: name, from: tokens[name], to: fallback, against: "", ratio: 0 });
      tokens[name] = fallback;
    }
    return parsed;
  };
  for (const [fg, list] of needs(options.high ?? false)) {
    const color = read(fg);
    if (!color) continue;
    const grounds = list.flatMap((need) => {
      const base = read(need.ground);
      const tint = need.layer ? read(need.layer) : undefined;
      if (!base || (need.layer && !tint)) return [];
      return [{ ...need, bg: tint ? over(tint, base) : base }];
    });
    const worst = (c: Rgba) => Math.min(...grounds.map((g) => contrast(c, g.bg) / g.ratio));
    if (grounds.length === 0 || worst(color) >= 1 - 1e-9) continue;
    const fixed = reachAll(color, (c) => worst(c) >= 1 - 1e-9, worst);
    const to = formatColor(fixed);
    const tightest = grounds.reduce((a, b) =>
      contrast(fixed, a.bg) / a.ratio <= contrast(fixed, b.bg) / b.ratio ? a : b,
    );
    fixes.push({
      token: fg,
      from: tokens[fg] ?? "",
      to,
      against: tightest.layer ? `${tightest.layer} over ${tightest.ground}` : tightest.ground,
      ratio: Math.round(contrast(fixed, tightest.bg) * 100) / 100,
    });
    tokens[fg] = to;
  }
  return { tokens, fixes };
}

/**
 * The colour nearest `color` in OKLCH lightness for which `ok` holds; its hue, chroma (as far as
 * sRGB allows) and alpha kept. When no lightness works, the one that scores best.
 */
export function reachAll(color: Rgba, ok: (c: Rgba) => boolean, score: (c: Rgba) => number): Rgba {
  const [L, C, H] = toOklch(color);
  // Whole channels, as formatColor writes them, so what passes here passes once written.
  const at = (lightness: number): Rgba => [
    ...(fromOklch(lightness, C, H).map(Math.round) as [number, number, number]),
    color[3],
  ];
  let best: { delta: number; value: Rgba } | undefined;
  for (const end of [0, 1]) {
    const steps = 64;
    let found = -1;
    for (let i = 1; i <= steps; i++) {
      if (ok(at(L + ((end - L) * i) / steps))) {
        found = i;
        break;
      }
    }
    if (found < 0) continue;
    let lo = (found - 1) / steps;
    let hi = found / steps;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (ok(at(L + (end - L) * mid))) hi = mid;
      else lo = mid;
    }
    const delta = Math.abs(end - L) * hi;
    if (!best || delta < best.delta) best = { delta, value: at(L + (end - L) * hi) };
  }
  if (best) return best.value;
  const black: Rgba = [0, 0, 0, color[3]];
  const white: Rgba = [255, 255, 255, color[3]];
  return score(black) >= score(white) ? black : white;
}

/** The colour nearest `color` in OKLCH lightness that reaches `need` on `bg`. */
export function reach(color: Rgba, bg: Rgba, need: number): Rgba {
  const score = (c: Rgba) => contrast(c, bg) / need;
  return reachAll(color, (c) => score(c) >= 1 - 1e-9, score);
}
