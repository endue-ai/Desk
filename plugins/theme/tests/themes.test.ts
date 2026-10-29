import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { tokens } from "../../../packages/ui/src/index";

const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
) as PluginManifest;
const themes = manifest.contributes?.themes ?? [];

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

describe("the default themes", () => {
  it("give a full token set for light and dark; the dark one is the design's", () => {
    const base = themes.filter((t) => (t.contrast ?? "normal") === "normal");
    expect(base.map((t) => t.scheme).sort()).toEqual(["dark", "light"]);
    for (const theme of base)
      expect(Object.keys(theme.tokens)).toEqual(expect.arrayContaining(Object.keys(tokens)));
    const dark = base.find((t) => t.scheme === "dark");
    expect(dark?.tokens).toMatchObject(tokens);
  });

  it("keep text at 4.5:1 or more on the background and cards, and 7:1 with high contrast", () => {
    for (const scheme of ["light", "dark"] as const) {
      const normal = themes.find((t) => t.scheme === scheme && t.contrast !== "high")?.tokens ?? {};
      const high = {
        ...normal,
        ...themes.find((t) => t.scheme === scheme && t.contrast === "high")?.tokens,
      };
      for (const [set, min] of [
        [normal, 4.5],
        [high, 7],
      ] as const) {
        for (const surface of ["background", "card"]) {
          for (const ink of ["text", "textMuted"]) {
            const ratio = contrast(set[ink] ?? "", set[surface] ?? "");
            expect(ratio, `${scheme} ${ink} on ${surface}`).toBeGreaterThanOrEqual(min);
          }
        }
      }
    }
  });
});
