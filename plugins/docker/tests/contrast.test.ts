// NF-05: the colours the Docker surface owns (its states, the stderr lines, port links and the
// sparklines' series) are the theme's tokens, and in the desk's light and dark schemes they reach
// 4.5:1 as text and 3:1 as graphics (WCAG 1.4.3, 1.4.11) on every surface they are drawn on: the
// page, a card, a sunken panel, the hovered or selected row, and a state badge's own soft fill.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { contrast, over, parseColor, type Rgba } from "../../../packages/ui/src/theme/index";
import { colors } from "../../../packages/ui/src/tokens";

const root = join(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const kebab = (name: string) => name.replace(/[A-Z0-9]+/g, (m) => `-${m.toLowerCase()}`);

/** The --desk-* colours of a scheme: the built-in dark set, the theme plugin's light set over it. */
function scheme(name: "light" | "dark"): Record<string, string> {
  const manifest = JSON.parse(read("plugins/theme/plugin.json")) as PluginManifest;
  const layer = manifest.contributes?.themes?.find(
    (t) => t.scheme === name && (t.contrast ?? "normal") === "normal",
  )?.tokens;
  const merged = { ...colors, ...(name === "light" ? layer : {}) } as Record<string, string>;
  return Object.fromEntries(Object.entries(merged).map(([k, v]) => [`--desk-${kebab(k)}`, v]));
}

/** The plugin's own colours: the custom properties style.css declares on :root. */
function owned(): Record<string, string> {
  const css = read("plugins/docker/ui/style.css");
  const block = /:root\s*{([^}]*)}/.exec(css)?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/(--docker-[a-z-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2]?.trim()]),
  ) as Record<string, string>;
}

/** A value with var() and color-mix(in srgb, …) worked out, as an opaque or translucent colour. */
function resolve(value: string, tokens: Record<string, string>): Rgba {
  const text = value.trim();
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(text)?.[1];
  if (ref) {
    const next = tokens[ref];
    if (!next) throw new Error(`no token ${ref}`);
    return resolve(next, tokens);
  }
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/.exec(text);
  if (mix) {
    const a = resolve(mix[1] ?? "", tokens);
    const b = resolve(mix[3] ?? "", tokens);
    const p = Number(mix[2]) / 100;
    return [0, 1, 2, 3].map((i) => (a[i] ?? 0) * p + (b[i] ?? 0) * (1 - p)) as Rgba;
  }
  const colour = parseColor(text);
  if (!colour) throw new Error(`not a colour: ${text}`);
  return colour;
}

const TEXT = ["running", "paused", "stopped", "failed", "stderr", "link"];
const GRAPHICS = ["cpu", "mem", "net", "running", "paused", "failed", "stopped"];
const SURFACES = ["background", "card", "muted", "hover"];
/** The state badges: the state's text on its status's soft fill. */
const BADGES: Array<[string, string]> = [
  ["running", "success-soft"],
  ["paused", "warning-soft"],
  ["failed", "danger-soft"],
];

describe("the Docker colours (NF-05)", () => {
  const mine = owned();

  it("are the plugin's own names for theme tokens, one per state, link and series", () => {
    for (const role of new Set([...TEXT, ...GRAPHICS]))
      expect(mine[`--docker-${role}`], role).toMatch(/var\(--desk-/);
  });

  for (const name of ["light", "dark"] as const) {
    const tokens = { ...scheme(name), ...mine };
    const ground = (surface: string) => resolve(`var(--desk-${surface})`, tokens);
    const on = (fg: string, bg: Rgba) => {
      const base = over(bg, ground("card"));
      return contrast(over(resolve(`var(--docker-${fg})`, tokens), base), base);
    };

    it(`read as text at 4.5:1 on every surface in the ${name} scheme`, () => {
      const failing: string[] = [];
      for (const role of TEXT)
        for (const surface of SURFACES) {
          const ratio = on(role, ground(surface));
          if (!(ratio >= 4.5)) failing.push(`${role} on ${surface}: ${ratio.toFixed(2)}`);
        }
      for (const [role, fill] of BADGES) {
        const ratio = on(role, ground(fill));
        if (!(ratio >= 4.5)) failing.push(`${role} on ${fill}: ${ratio.toFixed(2)}`);
      }
      expect(failing).toEqual([]);
    });

    it(`show as dots and sparklines at 3:1 in the ${name} scheme`, () => {
      const failing: string[] = [];
      for (const role of GRAPHICS)
        for (const surface of SURFACES) {
          const ratio = on(role, ground(surface));
          if (!(ratio >= 3)) failing.push(`${role} on ${surface}: ${ratio.toFixed(2)}`);
        }
      expect(failing).toEqual([]);
    });
  }
});
