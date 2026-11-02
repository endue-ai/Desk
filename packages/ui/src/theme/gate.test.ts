import { describe, expect, it } from "vitest";
import { colors } from "../tokens";
import { contrast, gate, NON_TEXT_PAIRS, parseColor, TEXT_PAIRS, toOklch } from "./index";

const SURFACES = ["background", "card", "muted", "popover", "hover"];
const ratio = (tokens: Record<string, string>, fg: string, bg: string) => {
  const a = parseColor(tokens[fg] ?? "");
  const b = parseColor(tokens[bg] ?? "");
  if (!a || !b) throw new Error(`${fg} on ${bg}`);
  return contrast(a, b);
};

describe("the theme gate", () => {
  it("leaves the desk's own dark palette as it is", () => {
    const { tokens, fixes } = gate(colors);
    expect(fixes).toEqual([]);
    expect(tokens).toEqual(colors);
  });

  it("fixes failing text by lightness alone, just to the threshold, and says so", () => {
    const dim = { ...colors, textMuted: "#55525a", primaryText: "#4a3c80" };
    const { tokens, fixes } = gate(dim);
    expect(fixes.map((f) => f.token).sort()).toEqual(["primaryText", "textMuted"]);
    for (const surface of SURFACES)
      expect(ratio(tokens, "textMuted", surface)).toBeGreaterThanOrEqual(4.5);
    // Moved as little as reaches 4.5:1 on the lightest surface it sits on (hover).
    expect(ratio(tokens, "textMuted", "hover")).toBeLessThan(4.7);
    const [, beforeC, beforeH] = toOklch(parseColor("#4a3c80") ?? [0, 0, 0, 1]);
    const [, afterC, afterH] = toOklch(parseColor(tokens.primaryText ?? "") ?? [0, 0, 0, 1]);
    expect(Math.abs(afterH - beforeH)).toBeLessThan(6);
    expect(afterC).toBeGreaterThan(beforeC * 0.5);
    const fix = fixes.find((f) => f.token === "textMuted");
    expect(fix).toMatchObject({ from: "#55525a" });
    expect(fix?.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("fixes borders and fills to 3:1 against the surfaces", () => {
    const faint = { ...colors, input: "#2a282e", success: "#203f22" };
    const { tokens, fixes } = gate(faint);
    expect(fixes.map((f) => f.token)).toEqual(expect.arrayContaining(["input", "success"]));
    for (const [fg, bg] of NON_TEXT_PAIRS) expect(ratio(tokens, fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it("never changes a ground", () => {
    const light = {
      ...colors,
      background: "#f6f1e7",
      card: "#fbf8f1",
      muted: "#efe7d8",
      popover: "#fbf8f1",
      hover: "#e9dfcc",
      tooltip: "#2b2620",
    };
    const { tokens } = gate(light);
    for (const surface of SURFACES)
      expect(tokens[surface]).toBe(light[surface as keyof typeof light]);
    for (const [fg, bg, layer] of TEXT_PAIRS) {
      if (layer) continue;
      expect(ratio(tokens, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("derives high contrast from a theme's own colours: 7:1 for key text on every surface", () => {
    const paper = {
      ...colors,
      background: "#f6f1e7",
      card: "#fbf8f1",
      muted: "#efe7d8",
      popover: "#fbf8f1",
      hover: "#e9dfcc",
      text: "#3b342b",
      textMuted: "#6b6255",
      primary: "#1f3a93",
      primaryForeground: "#e8ecff",
      primaryText: "#2a4bb0",
    };
    const { tokens } = gate(paper, { high: true });
    for (const surface of SURFACES)
      for (const ink of ["text", "textMuted", "primaryText"])
        expect(ratio(tokens, ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(7);
    expect(ratio(tokens, "primaryForeground", "primary")).toBeGreaterThanOrEqual(7);
    for (const [fg, bg] of NON_TEXT_PAIRS)
      expect(ratio(tokens, fg, bg)).toBeGreaterThanOrEqual(4.5);
    // Still the theme's hue: the ink stays blue, not black.
    const [, chroma, hue] = toOklch(parseColor(tokens.primaryText ?? "") ?? [0, 0, 0, 1]);
    expect(chroma).toBeGreaterThan(0.05);
    expect(hue).toBeGreaterThan(240);
    expect(hue).toBeLessThan(290);
  });

  it("falls back to the desk's value for a token that is not a colour it reads", () => {
    const { tokens, fixes } = gate({ ...colors, text: "papayawhip-ish" }, { fallback: colors });
    expect(tokens.text).toBe(colors.text);
    expect(fixes[0]).toMatchObject({ token: "text", from: "papayawhip-ish", to: colors.text });
  });

  it("reads hex, rgb(), hsl() and oklch()", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("#00000080")?.[3]).toBeCloseTo(0.5, 2);
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30, 0.5]);
    expect(parseColor("rgb(10 20 30 / 50%)")).toEqual([10, 20, 30, 0.5]);
    expect(parseColor("hsl(0, 100%, 50%)")?.slice(0, 3).map(Math.round)).toEqual([255, 0, 0]);
    expect(parseColor("oklch(1 0 0)")?.slice(0, 3).map(Math.round)).toEqual([255, 255, 255]);
    expect(parseColor("var(--x)")).toBeUndefined();
  });
});
