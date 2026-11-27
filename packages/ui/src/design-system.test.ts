import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cssVariables, tokensCss } from "./index";

const sheet = (name: string) => {
  const path = new URL(`./${name}`, import.meta.url);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};

describe("the shared design system", () => {
  it("gives shell and plugin pages the same semantic colors and scale", () => {
    const variables = cssVariables();
    expect(variables).toMatchObject({
      // endue.ai/design's Stone: the fill is ink (paper in the dark), and the star has the colour.
      "--desk-primary": "#f3f1ec",
      "--desk-primary-foreground": "#1c1a17",
      "--desk-ring": "#f3f1ec",
      "--desk-star": "#b6a3f5",
      "--desk-text-sm": "14px",
      "--desk-space-3": "12px",
      "--desk-control-sm": "32px",
      "--desk-motion-fast": "150ms",
    });
    expect(sheet("tokens.css")).toBe(tokensCss());
  });

  it("provides shared toolbar, empty and actionable error page patterns", () => {
    const css = `${sheet("base.css")}\n${sheet("patterns.css")}`;
    for (const name of ["desk-bar", "desk-bar-title", "desk-pane", "desk-empty", "desk-error"])
      expect(css).toContain(`.${name}`);
    // endue.ai/design's patterns: header, list, callout, chips, keycap, dot, star, loading.
    for (const name of [
      "desk-header",
      "desk-list-row",
      "desk-callout",
      "desk-chip",
      "desk-kbd",
      "desk-dot",
      "desk-star",
      "desk-skeleton",
      "desk-spinner",
    ])
      expect(css).toContain(`.${name}`);
    // The star's colour is the star's alone: no other rule of the sheets reads it.
    expect(css.match(/var\(--desk-star\)/g)).toHaveLength(1);
    expect(css).toContain("var(--desk-danger-text)");
    expect(css).toContain("var(--desk-danger-soft)");
    expect(css).toContain(":focus-visible");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    for (const match of css.matchAll(/var\((--desk-[a-z0-9-]+)/g))
      expect(cssVariables()).toHaveProperty(match[1] ?? "");
  });
});
