import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { contrast, over, parseColor } from "../../../packages/runtime/src/shell/contrast";
import { colors } from "../../../packages/ui/src/index";

const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
) as PluginManifest;
const themes = manifest.contributes?.themes ?? [];
type Scheme = "light" | "dark";
const normal = (scheme: Scheme) =>
  themes.find((t) => t.scheme === scheme && (t.contrast ?? "normal") === "normal")?.tokens ?? {};
const high = (scheme: Scheme) => ({
  ...normal(scheme),
  ...themes.find((t) => t.scheme === scheme && t.contrast === "high")?.tokens,
});
const STATUSES = ["success", "warning", "danger", "info"];
const SURFACES = ["background", "card", "muted", "popover", "hover"];

// [text token, surface token, a translucent layer over the surface?]: 4.5:1 or more.
const TEXT: [string, string, string?][] = [
  ...SURFACES.flatMap((s): [string, string][] => [
    ["text", s],
    ["textMuted", s],
  ]),
  ["text", "card", "primarySoft"],
  ["primaryText", "background"],
  ["primaryText", "card"],
  ["primaryText", "card", "primarySoft"],
  ["primaryForeground", "primary"],
  ["primaryForeground", "primaryHover"],
  ["tooltipText", "tooltip"],
  ...STATUSES.flatMap((s): [string, string, string?][] => [
    [`${s}Foreground`, s],
    [`${s}Text`, "card"],
    [`${s}Text`, "background"],
    [`${s}Text`, "card", `${s}Soft`],
    ["text", "card", `${s}Soft`],
  ]),
];
// [border or fill token, surface token]: 3:1 or more.
const NON_TEXT: [string, string][] = [
  ["input", "background"],
  ["input", "card"],
  ["ring", "background"],
  ["ring", "card"],
  ...STATUSES.map((s): [string, string] => [s, "card"]),
];

const ratio = (set: Record<string, string>, fg: string, bg: string, layer?: string) => {
  const color = (name: string) => {
    const value = set[name];
    if (!value) throw new Error(`missing token ${name}`);
    return parseColor(value);
  };
  return contrast(color(fg), layer ? over(color(layer), color(bg)) : color(bg));
};

describe("the endue theme", () => {
  it("gives light and dark exactly the role colours of @endue-ai/ui; the dark one is the design's", () => {
    for (const scheme of ["dark", "light"] as const)
      expect(Object.keys(normal(scheme)).sort(), scheme).toEqual(Object.keys(colors).sort());
    expect(normal("dark")).toEqual(colors);
  });

  it("lets the high-contrast layers change role colours only", () => {
    for (const theme of themes.filter((t) => t.contrast === "high")) {
      for (const name of Object.keys(theme.tokens)) expect(name in colors, name).toBe(true);
    }
  });

  describe.each(["dark", "light"] as const)("%s", (scheme) => {
    const set = normal(scheme);
    it.each(TEXT)("text %s on %s (%s) is at least 4.5:1", (fg, bg, layer) => {
      expect(ratio(set, fg, bg, layer)).toBeGreaterThanOrEqual(4.5);
    });
    it.each(NON_TEXT)("border or fill %s on %s is at least 3:1", (fg, bg) => {
      expect(ratio(set, fg, bg)).toBeGreaterThanOrEqual(3);
    });
    it("reaches 7:1 for text with high contrast", () => {
      const strong = high(scheme);
      for (const surface of SURFACES) {
        for (const ink of ["text", "textMuted", "primaryText"]) {
          expect(ratio(strong, ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(7);
        }
      }
      expect(ratio(strong, "primaryForeground", "primary")).toBeGreaterThanOrEqual(7);
    });
  });
});
