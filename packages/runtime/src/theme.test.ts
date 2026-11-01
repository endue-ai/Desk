import { tokens } from "@endue-ai/ui";
import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

const theme = (
  id: string,
  scheme: "light" | "dark",
  values: Record<string, string>,
  contrast?: "normal" | "high",
) => ({
  id,
  name: id,
  scheme,
  tokens: values,
  owner: id.split(".").slice(0, 2).join("."),
  ...(contrast ? { contrast } : {}),
});

const themes = [
  theme("desk.theme.dark", "dark", { background: "#141416", success: "#5dbe5f" }),
  theme("desk.theme.light", "light", { background: "#faf9fc", text: "#1e1833" }),
  theme("desk.theme.light-contrast", "light", { text: "#000000" }, "high"),
  theme("example.paper.light", "light", { background: "#fdfcf8" }),
];
const os = { dark: false, highContrast: false, reducedMotion: false };

describe("resolveTheme", () => {
  it("keeps the built-in tokens when no theme is contributed", () => {
    const state = resolveTheme([], { scheme: "dark", contrast: "normal", motion: "full" }, os);
    expect(state.tokens).toEqual(tokens);
    expect(state.themes).toEqual([]);
  });

  it("layers the themes of the scheme, later over earlier", () => {
    const state = resolveTheme(themes, { scheme: "light", contrast: "normal", motion: "full" }, os);
    expect(state.themes).toEqual(["desk.theme.light", "example.paper.light"]);
    expect(state.tokens.background).toBe("#fdfcf8");
    expect(state.tokens.text).toBe("#1e1833");
    expect(state.variables["--desk-background"]).toBe("#fdfcf8");
  });

  it("puts high-contrast themes over the normal ones when contrast is high", () => {
    const state = resolveTheme(themes, { scheme: "light", contrast: "high", motion: "full" }, os);
    expect(state.themes.at(-1)).toBe("desk.theme.light-contrast");
    expect(state.tokens.text).toBe("#000000");
  });

  it("zeroes the motion tokens under reduced motion, and only then", () => {
    const still = resolveTheme(
      themes,
      { scheme: "dark", contrast: "normal", motion: "reduce" },
      os,
    );
    expect(still.reducedMotion).toBe(true);
    expect(still.tokens.motionFast).toBe("0ms");
    expect(still.variables["--desk-motion-theme"]).toBe("0ms");
    const moving = resolveTheme(themes, { scheme: "dark", contrast: "normal", motion: "full" }, os);
    expect(moving.tokens.motionFast).toBe(tokens.motionFast);
  });

  it("carries the scale to every frame beside the colours", () => {
    const state = resolveTheme(themes, { scheme: "light", contrast: "normal", motion: "full" }, os);
    expect(state.variables["--desk-text-sm"]).toBe("14px");
    expect(state.variables["--desk-space-2"]).toBe("8px");
    expect(state.variables["--desk-radius-md"]).toBe("8px");
  });

  it("follows the system for scheme, contrast and motion when asked", () => {
    const system = { scheme: "system", contrast: "system", motion: "system" } as const;
    const night = resolveTheme(themes, system, {
      dark: true,
      highContrast: true,
      reducedMotion: true,
    });
    expect([night.scheme, night.contrast, night.reducedMotion]).toEqual(["dark", "high", true]);
    const day = resolveTheme(themes, system, os);
    expect([day.scheme, day.contrast, day.reducedMotion]).toEqual(["light", "normal", false]);
  });
  it("shares typography, spacing and motion with every themed surface", () => {
    const state = resolveTheme([], { scheme: "dark", contrast: "normal", motion: "reduce" }, os);
    expect(state.variables["--desk-font-sans"]).toContain("Inter");
    expect(state.variables["--desk-space-3"]).toBe("12px");
    for (const name of ["fast", "base", "slow", "theme"])
      expect(state.variables[`--desk-motion-${name}`]).toBe("0ms");
  });

  it("keeps legacy accent themes effective on semantic controls", () => {
    const state = resolveTheme(
      [theme("custom.legacy.dark", "dark", { accent: "#abcdef" })],
      { scheme: "dark", contrast: "normal", motion: "full" },
      os,
    );
    for (const name of ["primary", "primaryText", "primaryHover", "ring"])
      expect(state.tokens[name]).toBe("#abcdef");
    expect(state.tokens.primaryForeground).toBe(state.tokens.background);
  });

  it("keeps explicitly contributed semantic roles and updates legacy consumers", () => {
    const state = resolveTheme(
      [
        theme("custom.modern.dark", "dark", {
          primary: "#abcdef",
          primaryText: "#fedcba",
          ring: "#ffffff",
        }),
      ],
      { scheme: "dark", contrast: "normal", motion: "full" },
      os,
    );
    expect(state.tokens.accent).toBe("#abcdef");
    expect(state.tokens.primaryText).toBe("#fedcba");
    expect(state.tokens.ring).toBe("#ffffff");
  });
});
