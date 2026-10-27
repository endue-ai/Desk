import { describe, expect, it } from "vitest";
import { cssVariables, tokens } from "./index";

describe("theme tokens", () => {
  it("have the design values", () => {
    expect(tokens).toEqual({
      background: "#141416",
      card: "#1e1d21",
      border: "#333136",
      text: "#f2f0f5",
      textMuted: "#b0adb7",
      accent: "#b6a3f5",
    });
  });

  it("become CSS custom properties", () => {
    expect(cssVariables()).toEqual({
      "--desk-background": "#141416",
      "--desk-card": "#1e1d21",
      "--desk-border": "#333136",
      "--desk-text": "#f2f0f5",
      "--desk-text-muted": "#b0adb7",
      "--desk-accent": "#b6a3f5",
    });
  });
});
