import { describe, expect, it } from "vitest";
import { NATIVE_CSS, SCROLLBAR_THUMB } from "./native-css";
import { contrast, parseColor } from "./theme/color";
import { NON_TEXT_PAIRS } from "./theme/gate";
import { colors } from "./tokens";

/** The sheet's rules in order, as [selector, { property: value }]. */
function rules(css: string): Array<[string, Record<string, string>]> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...text.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector = "", body = ""]) => [
    selector.trim().replace(/\s+/g, " "),
    Object.fromEntries(
      body
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]),
    ),
  ]);
}

const sheet = rules(NATIVE_CSS);
const where = (property: string) => sheet.filter(([, decls]) => property in decls);

describe("the engine's own parts follow the theme", () => {
  it("every selector weighs nothing, so a page's own rule wins", () => {
    expect(sheet.length).toBeGreaterThan(0);
    for (const [selector] of sheet) expect(selector).toMatch(/^:where\(.*\)$/);
  });

  it("the scheme is dark at first and wherever the theme is dark, light where it is light", () => {
    const schemes = where("color-scheme").map(([selector, d]) => [selector, d["color-scheme"]]);
    expect(schemes).toEqual([
      [':where(:root, [data-scheme="dark"])', "dark"],
      // Last: a root that is :root and [data-scheme="light"] at once takes it (equal weight).
      [':where([data-scheme="light"])', "light"],
    ]);
  });

  it("scrollbars: a thumb the gate holds 3:1 against the grounds, over a clear track", () => {
    const [[selector, decls] = ["", {}]] = where("scrollbar-color");
    // Set where the theme's tokens are set, so the thumb is the theme's colour, inherited below.
    expect(selector).toBe(":where(:root, [data-scheme])");
    expect(decls["scrollbar-color"]).toBe(`var(--desk-${SCROLLBAR_THUMB}) transparent`);
    expect(NON_TEXT_PAIRS).toContainEqual([SCROLLBAR_THUMB, "background"]);
    expect(NON_TEXT_PAIRS).toContainEqual([SCROLLBAR_THUMB, "card"]);
    const thumb = parseColor(colors[SCROLLBAR_THUMB]);
    for (const ground of [colors.background, colors.card]) {
      const behind = parseColor(ground);
      if (!thumb || !behind) throw new Error("unreadable default colour");
      expect(contrast(thumb, behind)).toBeGreaterThanOrEqual(3);
    }
    expect(where("scrollbar-width")).toEqual([[":where(*)", { "scrollbar-width": "thin" }]]);
  });

  it("checkboxes, radios, ranges and progress bars take the design system's check accent", () => {
    const [[selector, decls] = ["", {}]] = where("accent-color");
    expect(selector).toBe(":where(:root, [data-scheme])");
    expect(decls["accent-color"]).toBe("var(--desk-check-accent)");
  });
});
