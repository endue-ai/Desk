import { describe, expect, it } from "vitest";
import { colors as desk } from "../tokens";
import {
  contrast,
  gate,
  NON_TEXT_PAIRS,
  paletteFrom,
  parseColor,
  TEXT_PAIRS,
  toOklch,
} from "./index";

const rgba = (c: string | undefined) => {
  const parsed = parseColor(c ?? "");
  if (!parsed) throw new Error(`not a colour: ${c}`);
  return parsed;
};
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

// A logo's five colours, by area: cream paper, navy ink, the brand orange, teal and gold.
const LOGO = ["#f7f3e8", "#1d2a44", "#e4572e", "#2e9e8f", "#f2c14e"];

describe("paletteFrom", () => {
  for (const scheme of ["light", "dark"] as const) {
    it(`builds a ${scheme} palette that passes the gate as it is`, () => {
      const { colors } = paletteFrom(LOGO, scheme);
      // Every token the gate measures is the palette's own, so the desk's values never decide.
      for (const [fg, bg, layer] of TEXT_PAIRS) {
        expect(colors[fg], fg).toBeDefined();
        expect(colors[bg], bg).toBeDefined();
        if (layer) expect(colors[layer], layer).toBeDefined();
      }
      for (const [fg, bg] of NON_TEXT_PAIRS) expect(colors[fg] && colors[bg], fg).toBeTruthy();
      expect(gate(colors).fixes).toEqual([]);
      expect(gate({ ...desk, ...colors }).fixes).toEqual([]);
    });
  }

  it("keeps the most saturated colour as the primary, and its companions follow it", () => {
    for (const scheme of ["light", "dark"] as const) {
      const { colors, brand } = paletteFrom(LOGO, scheme);
      expect(brand).toBe("#e4572e");
      expect(colors.primary, scheme).toBe("#e4572e");
      expect(colors.ring, scheme).toBe("#e4572e");
      expect(contrast(rgba(colors.primaryForeground), rgba(colors.primary))).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("takes the lightest colour for a light background and the darkest for a dark one", () => {
    const light = paletteFrom(LOGO, "light").colors;
    const dark = paletteFrom(LOGO, "dark").colors;
    const [lightL] = toOklch(rgba(light.background));
    const [darkL, darkC, darkH] = toOklch(rgba(dark.background));
    expect(lightL).toBeGreaterThan(0.94);
    expect(darkL).toBeLessThan(0.25);
    // The dark ground is the navy ink's, darkened: its hue stays.
    expect(darkC).toBeGreaterThan(0.01);
    expect(hueGap(darkH, toOklch(rgba("#1d2a44"))[2])).toBeLessThan(10);
    expect(hueGap(toOklch(rgba(light.background))[2], toOklch(rgba("#f7f3e8"))[2])).toBeLessThan(
      15,
    );
  });

  it("moves only the brand's lightness when it would vanish on the ground", () => {
    // A navy brand on a near-black logo: kept on light, lifted on dark until the ring shows (3:1).
    const navy = ["#101828", "#1a2a80", "#f4f4f4"];
    const light = paletteFrom(navy, "light");
    const dark = paletteFrom(navy, "dark");
    expect(light.colors.primary).toBe("#1a2a80");
    expect(dark.brand).toBe("#1a2a80");
    expect(dark.colors.primary).not.toBe("#1a2a80");
    const [, beforeC, beforeH] = toOklch(rgba("#1a2a80"));
    const [, afterC, afterH] = toOklch(rgba(dark.colors.primary));
    expect(hueGap(afterH, beforeH)).toBeLessThan(6);
    expect(afterC).toBeGreaterThan(beforeC * 0.5);
    expect(
      contrast(rgba(dark.colors.primary), rgba(dark.colors.background)),
    ).toBeGreaterThanOrEqual(3);
    expect(gate(dark.colors).fixes).toEqual([]);
  });

  it("still makes a passing palette from a black and white logo", () => {
    for (const scheme of ["light", "dark"] as const) {
      const { colors } = paletteFrom(["#ffffff", "#000000"], scheme);
      expect(gate(colors).fixes, scheme).toEqual([]);
      expect(contrast(rgba(colors.primary), rgba(colors.background))).toBeGreaterThanOrEqual(3);
    }
  });
});
