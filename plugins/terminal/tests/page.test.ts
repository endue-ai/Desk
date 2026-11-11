// The terminal's page never scrolls and its cells never reach past the pane, so a fit is final. Before,
// the fit addon counted the pane's own padding as room for cells (getComputedStyle of a border-box
// element reads padding into its width and height): the last column and row hung over the pane, the
// page overflowed, a scroll bar of its own took room from the panes, the terminal refit to the smaller
// box, the bar went, and the terminal refit back, over and over, rewrapping every line each time.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "../ui/style.css"), "utf8");
/** The declarations of the rule whose selector list is exactly `selectors`. */
const rule = (selectors: string) => {
  const at = css.indexOf(`\n${selectors} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

describe("the terminal's page", () => {
  it("never scrolls: no scroll bar of its own takes room from the panes", () => {
    expect(rule("html,\nbody")).toContain("overflow: hidden;");
    expect(rule("#panes")).toContain("overflow: hidden;");
    expect(rule(".pane")).toContain("overflow: hidden;");
  });

  it("keeps the gap around the cells on xterm's own element, which the fit subtracts", () => {
    expect(rule(".pane")).not.toMatch(/padding/u);
    const xterm = rule(".pane .xterm");
    expect(xterm).toMatch(/padding: 4px 0 0 6px;/u);
    expect(xterm).toContain("box-sizing: border-box;");
    expect(xterm).toContain("height: 100%;");
  });

  // In a light theme the gap was a black frame around a white terminal (#158, item 18): xterm's own
  // sheet paints its viewport, which spans the gap, black; only the screen takes the theme.
  it("shows the theme's background in the gap around the cells, not xterm's black", () => {
    const vendor = readFileSync(join(import.meta.dirname, "../ui/vendor/xterm.css"), "utf8");
    expect(vendor).toMatch(/\.xterm \.xterm-viewport \{[^}]*background-color: #000;/u);
    expect(rule(".pane .xterm .xterm-viewport")).toContain(
      "background-color: var(--desk-background);",
    );
  });
});
