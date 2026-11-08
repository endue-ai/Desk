import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { contrast, parseColor } from "../../../packages/ui/src/theme/index";

const themes = (plugin: string) =>
  (
    JSON.parse(
      readFileSync(join(import.meta.dirname, `../../${plugin}/plugin.json`), "utf8"),
    ) as PluginManifest
  ).contributes?.themes ?? [];
const tokens = (plugin: string, id: string) =>
  themes(plugin).find((theme) => theme.id === id)?.tokens ?? {};
const eris = (set: Record<string, string>) =>
  Object.fromEntries(Object.entries(set).filter(([name]) => name.startsWith("eris")));

const dark = tokens("shell", "desk.shell.dark");
const light = tokens("shell", "desk.shell.light");
// The surfaces she is drawn on in light: desk.theme's, under the shell's colours.
const surfaces = tokens("theme", "desk.theme.light");

const ratio = (fg: string, bg: string) => {
  const [color, ground] = [parseColor(light[fg] ?? ""), parseColor(surfaces[bg] ?? "")];
  if (!color || !ground) throw new Error(`no colour for ${fg} on ${bg}`);
  return contrast(color, ground);
};

describe("Eris in the light scheme (desk.shell.light)", () => {
  it("has a palette of her own: every eris* token dark sets, not dark's values", () => {
    expect(Object.keys(eris(light)).sort()).toEqual(Object.keys(eris(dark)).sort());
    expect(eris(light)).not.toEqual(eris(dark));
  });

  // Her outline: the lines and fill are erisFrost (draw.ts), the tail and edges erisShade. Her gold:
  // eris (halo, spark, gold lines, her name in soul text) and the deep end of the gold face.
  it.each([
    ["eris", "background"],
    ["eris", "card"],
    ["erisShade", "background"],
    ["erisShade", "card"],
    ["erisFrost", "background"],
    ["erisFrost", "card"],
    ["erisGoldDeep", "background"],
    ["erisGoldDeep", "card"],
  ])("%s reaches 3:1 on %s", (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
