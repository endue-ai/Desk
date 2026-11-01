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
  it("provides light and high contrast colors without a theme plugin", () => {
    const light = resolveTheme([], { scheme: "light", contrast: "normal", motion: "full" }, os);
    expect(light.tokens.background).toBe("#faf9fc");
    expect(light.tokens.text).toBe("#1e1833");
    const high = resolveTheme([], { scheme: "light", contrast: "high", motion: "reduce" }, os);
    expect(high.tokens.text).toBe("#000000");
    expect(high.reducedMotion).toBe(true);
  });
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
});
