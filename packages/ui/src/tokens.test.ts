import { describe, expect, it } from "vitest";
import { colors, cssVariables, material, propertyOf, scale, terminal, tokens } from "./index";

const HEX = /^#[0-9a-f]{6}$/;
const RGBA = /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0(\.\d+)?\)$/;
const SHADOW = /^0 \d+px \d+px rgba\(0, 0, 0, 0\.\d+\)$/;

describe("design tokens", () => {
  it("are the scale, the role colours, the material and the terminal colours, under distinct names", () => {
    expect(tokens).toEqual({ ...scale, ...colors, ...material, ...terminal });
    const groups = [scale, colors, material, terminal].map((group) => Object.keys(group));
    const all = groups.flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("keep today's look in the material and give the terminal sixteen colours", () => {
    expect(material).toEqual({
      surfaceOpacity: "1",
      blur: "0px",
      noise: "0",
      borderWidth: "1px",
      backdrop: "none",
      backdropSize: "cover",
      backdropRepeat: "no-repeat",
    });
    expect(Object.keys(terminal)).toEqual(Array.from({ length: 16 }, (_, i) => `ansi${i}`));
    for (const value of Object.values(terminal)) expect(value).toMatch(HEX);
    expect(propertyOf("ansi10")).toBe("--desk-ansi-10");
  });

  it("keep the design's dark values for the surfaces, text and the brand", () => {
    expect(colors).toMatchObject({
      background: "#141416",
      card: "#1e1d21",
      border: "#333136",
      text: "#f2f0f5",
      textMuted: "#b0adb7",
      primary: "#b6a3f5",
      primaryForeground: "#1e1833",
      ring: "#b6a3f5",
    });
    // The old name of the brand fill stays an alias until plugins have moved (docs/design-system.md).
    expect(colors.accent).toBe(colors.primary);
  });

  it("give every status a fill, an ink, a text, a soft surface and a border", () => {
    for (const status of ["success", "warning", "danger", "info"]) {
      const record = colors as Record<string, string>;
      expect(record[status]).toMatch(HEX);
      expect(record[`${status}Foreground`]).toMatch(HEX);
      expect(record[`${status}Text`]).toMatch(HEX);
      expect(record[`${status}Soft`]).toMatch(RGBA);
      expect(record[`${status}Border`]).toMatch(RGBA);
    }
  });

  it("hold colours, shadows and sizes only", () => {
    for (const [name, value] of Object.entries(colors)) {
      const kind = name.startsWith("shadow") ? SHADOW : HEX.test(value) ? HEX : RGBA;
      expect(value, name).toMatch(kind);
    }
    for (const [name, value] of Object.entries(scale)) {
      if (name.startsWith("font")) expect(value, name).toContain(",");
      else if (name === "tracking") expect(value).toBe("0em");
      else if (name === "easing") expect(value).toMatch(/^cubic-bezier\(/);
      else expect(value, name).toMatch(/^\d+(px|ms)$/);
    }
  });

  it("become --desk-* custom properties, digits hyphenated like the words", () => {
    expect(propertyOf("textMuted")).toBe("--desk-text-muted");
    expect(propertyOf("text2xs")).toBe("--desk-text-2xs");
    expect(propertyOf("text2xl")).toBe("--desk-text-2xl");
    expect(propertyOf("chart1")).toBe("--desk-chart-1");
    expect(propertyOf("space16")).toBe("--desk-space-16");
    expect(propertyOf("primaryForeground")).toBe("--desk-primary-foreground");
    const variables = cssVariables();
    for (const name of Object.keys(tokens)) expect(variables).toHaveProperty(propertyOf(name));
    expect(variables["--desk-background"]).toBe("#141416");
    expect(variables["--desk-text-sm"]).toBe("14px");
    expect(cssVariables({ paper: "#fdfcf8" })).toEqual({ "--desk-paper": "#fdfcf8" });
  });

  it("preserves numeric token names existing plugins already read", () => {
    expect(cssVariables({ lane1: "#abcdef" })).toEqual({
      "--desk-lane-1": "#abcdef",
      "--desk-lane1": "#abcdef",
    });
    expect(cssVariables()["--desk-space3"]).toBe(cssVariables()["--desk-space-3"]);
  });
});
