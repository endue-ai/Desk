import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginInfo, PluginManifest } from "@endue-ai/bridge";
import { describe, expect, test } from "vitest";
import { collect } from "../policy";
import { resolveTheme } from "../theme";
import { contrast, over, parseColor } from "./contrast";

// The shell's colours are desk.theme's tokens with plugins/shell's on top, as the runtime resolves them.
const manifest = (name: string): PluginInfo => {
  const url = new URL(`../../../../plugins/${name}/plugin.json`, import.meta.url);
  const m = JSON.parse(readFileSync(url, "utf8")) as PluginManifest;
  return { id: m.id, status: "ready", enabled: true, builtIn: true, revision: 1, manifest: m };
};
const { themes } = collect([manifest("theme"), manifest("shell")]);
const tokensOf = (scheme: "dark" | "light") =>
  resolveTheme(
    themes,
    { scheme, contrast: "normal", motion: "full" },
    { dark: true, highContrast: false, reducedMotion: false },
  ).tokens;

// [foreground token, background token, optional translucent layer over the background]
const TEXT: [string, string, string?][] = [
  ["text", "background"],
  ["text", "card"],
  ["text", "muted"],
  ["text", "popover"],
  ["text", "hover"],
  ["text", "card", "primarySoft"],
  ["textMuted", "background"],
  ["textMuted", "card"],
  ["textMuted", "muted"],
  ["textMuted", "popover"],
  ["textMuted", "hover"],
  ["accent", "background"],
  ["accent", "card"],
  ["accent", "popover"],
  ["accent", "card", "primarySoft"],
  ["primaryForeground", "primary"],
  ["primaryForeground", "primaryHover"],
  ["tooltipText", "tooltip"],
  ["secondaryForeground", "secondary"],
  ["success", "card"],
  ["warning", "card"],
  ["info", "card"],
  ["danger", "card"],
  ["statusAttentionText", "card"],
  ["statusAttentionText", "card", "statusAttentionSoft"],
  ["text", "card", "statusAttentionSoft"],
];

const NON_TEXT: [string, string][] = [
  ["input", "background"],
  ["input", "card"],
  ["accent", "background"],
  ["accent", "card"],
  ["successFill", "card"],
  ["infoFill", "card"],
  ["warningFill", "card"],
  ["statusActive", "card"],
  ["statusAttention", "card"],
];

describe.each(["dark", "light"] as const)("%s theme tokens", (scheme) => {
  const t = tokensOf(scheme);
  const color = (name: string) => {
    const value = t[name];
    if (!value) throw new Error(`missing token ${name}`);
    return parseColor(value);
  };
  const ground = (bg: string, layer?: string) =>
    layer ? over(color(layer), color(bg)) : color(bg);

  test.each(TEXT)("text %s on %s (%s) is at least 4.5:1", (fg, bg, layer) => {
    expect(contrast(color(fg), ground(bg, layer))).toBeGreaterThanOrEqual(4.5);
  });

  test.each(NON_TEXT)("icon or border %s on %s is at least 3:1", (fg, bg) => {
    // A status dot passes on its fill or on its outline (light theme outlines dots).
    const outline = t.dotOutline === "transparent" ? 0 : contrast(color("dotOutline"), color(bg));
    const isDot = !["input", "accent"].includes(fg);
    expect(Math.max(contrast(color(fg), color(bg)), isDot ? outline : 0)).toBeGreaterThanOrEqual(3);
  });
});

test("oklch parses to the expected sRGB", () => {
  const [r, g, b] = parseColor("oklch(0.577 0.245 27.325)");
  expect([Math.round(r), Math.round(g), Math.round(b)]).toEqual([231, 0, 11]);
});

test("the shell's stylesheets and scripts hold no literal colours: only theme tokens do", () => {
  // fileURLToPath, not .pathname: on Windows the latter is "/D:/..." and joins into "D:\\D:\\...".
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(css|ts)$/.test(name) && !/\.test\.ts$|contrast\.ts$/.test(name)) {
        if (/#[0-9a-f]{3,8}\b|rgba?\(|oklch\(/i.test(readFileSync(path, "utf8")))
          offenders.push(path);
      }
    }
  };
  for (const part of ["shell", "surface", "eris", "system"]) {
    walk(fileURLToPath(new URL(`../${part}`, import.meta.url)));
  }
  expect(offenders).toEqual([]);
});
