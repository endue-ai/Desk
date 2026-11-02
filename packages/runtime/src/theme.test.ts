import { tokens } from "@endue-ai/ui";
import { describe, expect, it } from "vitest";
import { type InstalledTheme, resolveTheme } from "./theme";

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

describe("the active theme (desk.theme.active)", () => {
  const url = (path: string) => `desk-plugin://localhost/example.ember/${path}?v=2`;
  const ember: InstalledTheme = {
    id: "example.ember",
    name: "Ember",
    url,
    theme: {
      type: {
        sans: '"Ember Sans", sans-serif',
        fonts: [{ family: "Ember Sans", src: "fonts/ember.woff2" }],
      },
      shape: { radius: "none" },
      motion: { personality: "calm" },
      dark: {
        colors: { background: "#1a1210", card: "#22171400", text: "#f6e9e2", primary: "#ff8a4c" },
        material: { noise: 0.05 },
        backdrop: { image: "images/coals.webp" },
      },
    },
  };
  const dark = { scheme: "dark", contrast: "normal", motion: "full" } as const;

  it("changes nothing until the setting names an installed theme", () => {
    const before = resolveTheme(themes, dark, os);
    expect(resolveTheme(themes, { ...dark, active: "" }, os, [ember])).toEqual(before);
    expect(resolveTheme(themes, { ...dark, active: "example.gone" }, os, [ember])).toEqual(before);
    expect(before.fonts).toEqual([]);
    expect(before.fixes).toEqual([]);
    expect(before.active).toBeUndefined();
  });

  it("goes over the policy layers with all its layers", () => {
    const state = resolveTheme(themes, { ...dark, active: "example.ember" }, os, [ember]);
    expect(state.active).toBe("example.ember");
    expect(state.themes).toEqual(["desk.theme.dark", "example.ember"]);
    expect(state.tokens).toMatchObject({
      background: "#1a1210",
      primary: "#ff8a4c",
      accent: "#ff8a4c",
      success: "#5dbe5f",
      radiusMd: "0px",
      motionFast: "220ms",
      noise: "0.05",
      fontSans: '"Ember Sans", sans-serif',
      backdrop: `url("${url("images/coals.webp")}")`,
    });
    expect(state.variables["--desk-radius-md"]).toBe("0px");
    expect(state.fonts).toEqual([{ family: "Ember Sans", url: url("fonts/ember.woff2") }]);
  });

  it("is gated: a colour that does not read is fixed and reported", () => {
    const state = resolveTheme(themes, { ...dark, active: "example.ember" }, os, [ember]);
    // card #22171400 is fully transparent: text is measured on it as on what lies below, so it passes,
    // while the desk's own textMuted on the new background must still reach 4.5:1.
    for (const fix of state.fixes) expect(fix.ratio).toBeGreaterThanOrEqual(3);
    const dim: InstalledTheme = {
      ...ember,
      theme: { dark: { colors: { background: "#202020", text: "#3a3a3a" } } },
    };
    const gated = resolveTheme(themes, { ...dark, active: "example.ember" }, os, [dim]);
    expect(gated.fixes.map((f) => f.token)).toContain("text");
    expect(gated.tokens.text).not.toBe("#3a3a3a");
  });

  it("keeps its shared layers in a scheme it has no variant for, with the desk's palette", () => {
    const state = resolveTheme(themes, { ...dark, scheme: "light", active: "example.ember" }, os, [
      ember,
    ]);
    expect(state.tokens.background).toBe("#fdfcf8");
    expect(state.tokens.radiusMd).toBe("0px");
    expect(state.tokens.text).toBe("#1e1833");
  });

  it("brings its own high contrast, derived from its colours, instead of the policy layers", () => {
    const light: InstalledTheme = {
      ...ember,
      theme: {
        light: {
          colors: {
            background: "#f6f1e7",
            card: "#fbf8f1",
            muted: "#efe7d8",
            popover: "#fbf8f1",
            hover: "#e9dfcc",
            text: "#6b6255",
            textMuted: "#7d7466",
            primaryText: "#2a4bb0",
          },
        },
      },
    };
    const state = resolveTheme(
      themes,
      { scheme: "light", contrast: "high", motion: "full", active: "example.ember" },
      os,
      [light],
    );
    expect(state.themes).not.toContain("desk.theme.light-contrast");
    expect(state.tokens.background).toBe("#f6f1e7");
    expect(state.fixes.map((f) => f.token)).toContain("text");
    // Darker for 7:1, but still the theme's warm grey, not black.
    expect(state.tokens.text).not.toBe("#000000");
    expect(state.tokens.text).not.toBe("#6b6255");
  });

  it("still stops motion under reduced motion", () => {
    const state = resolveTheme(themes, { ...dark, motion: "reduce", active: "example.ember" }, os, [
      ember,
    ]);
    expect(state.tokens.motionFast).toBe("0ms");
    expect(state.tokens.motionTheme).toBe("0ms");
  });
});
