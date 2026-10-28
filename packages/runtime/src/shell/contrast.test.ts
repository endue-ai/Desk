import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { contrast, over, parseColor, readTokens } from "./contrast";

const css = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");
const themes = readTokens(css);

// [foreground token, background token, optional translucent layer over the background]
const TEXT: [string, string, string?][] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["foreground", "muted"],
  ["foreground", "popover"],
  ["foreground", "accent"],
  ["foreground", "card", "primary-soft"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "popover"],
  ["muted-foreground", "accent"],
  ["primary-text", "background"],
  ["primary-text", "card"],
  ["primary-text", "popover"],
  ["primary-text", "card", "primary-soft"],
  ["primary-foreground", "primary"],
  ["primary-foreground", "primary-hover"],
  ["tooltip-foreground", "tooltip"],
  ["secondary-foreground", "secondary"],
  ["success-text", "card"],
  ["warning-text", "card"],
  ["info-text", "card"],
  ["destructive-text", "card"],
  ["status-attention-text", "card"],
  ["status-attention-text", "card", "status-attention-soft"],
  ["foreground", "card", "status-attention-soft"],
];

const NON_TEXT: [string, string][] = [
  ["input", "background"],
  ["input", "card"],
  ["ring", "background"],
  ["ring", "card"],
  ["success", "card"],
  ["info", "card"],
  ["warning", "card"],
  ["status-active", "card"],
  ["status-attention", "card"],
];

describe.each(["dark", "light"] as const)("%s theme tokens", (theme) => {
  const t = themes[theme];
  const color = (name: string) => {
    const value = t[name];
    if (!value) throw new Error(`missing --${name}`);
    return parseColor(value);
  };
  const ground = (bg: string, layer?: string) =>
    layer ? over(color(layer), color(bg)) : color(bg);

  test.each(TEXT)("text %s on %s (%s) is at least 4.5:1", (fg, bg, layer) => {
    expect(contrast(color(fg), ground(bg, layer))).toBeGreaterThanOrEqual(4.5);
  });

  test.each(NON_TEXT)("icon or border %s on %s is at least 3:1", (fg, bg) => {
    // A status dot passes on its fill or on its outline (light theme outlines dots).
    const outline =
      t["dot-outline"] === "transparent" ? 0 : contrast(color("dot-outline"), color(bg));
    const isDot = !["input", "ring"].includes(fg);
    expect(Math.max(contrast(color(fg), color(bg)), isDot ? outline : 0)).toBeGreaterThanOrEqual(3);
  });
});

test("oklch parses to the expected sRGB", () => {
  const [r, g, b] = parseColor("oklch(0.577 0.245 27.325)");
  expect([Math.round(r), Math.round(g), Math.round(b)]).toEqual([231, 0, 11]);
});

test("only tokens.css holds literal colours", () => {
  // fileURLToPath, not .pathname: on Windows the latter is "/D:/..." and joins into "D:\\D:\\...".
  const root = fileURLToPath(new URL("..", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (
        /\.(css|ts)$/.test(name) &&
        !/tokens\.css$|desk\.css$|\.test\.ts$|contrast\.ts$/.test(name)
      ) {
        if (/#[0-9a-f]{3,8}\b|rgba?\(|oklch\(/i.test(readFileSync(path, "utf8")))
          offenders.push(path);
      }
    }
  };
  walk(root);
  expect(offenders).toEqual([]);
});
