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
      "--desk-primary": "#b6a3f5",
      "--desk-primary-foreground": "#1e1833",
      "--desk-ring": "#b6a3f5",
      "--desk-text-sm": "14px",
      "--desk-space-3": "12px",
      "--desk-control-sm": "32px",
      "--desk-motion-fast": "150ms",
    });
    expect(sheet("tokens.css")).toBe(tokensCss());
  });

  it("provides shared toolbar, empty and actionable error page patterns", () => {
    const css = sheet("base.css");
    for (const name of ["desk-bar", "desk-bar-title", "desk-pane", "desk-empty", "desk-error"])
      expect(css).toContain(`.${name}`);
    expect(css).toContain("var(--desk-danger-text)");
    expect(css).toContain("var(--desk-danger-soft)");
    expect(css).toContain(":focus-visible");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    for (const match of css.matchAll(/var\((--desk-[a-z0-9-]+)/g))
      expect(cssVariables()).toHaveProperty(match[1] ?? "");
  });
});
