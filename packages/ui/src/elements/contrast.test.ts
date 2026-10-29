import { describe, expect, it } from "vitest";
import { cssVariables } from "../tokens";
import { elements } from "./index";
import { contrast, parseRules, tokenOf } from "./test-css";

const values = cssVariables();
// What an element without a background of its own sits on: the page, or a card such as a dialog.
const SURFACES = ["--desk-background", "--desk-card"];

/** Every text colour an element's rules can show, with each background it can show it on. */
function pairs(css: string): { selector: string; text: string; background: string }[] {
  const rules = parseRules(css);
  const host = rules.find((rule) => rule.selector === ":host")?.declarations ?? {};
  const hostText = tokenOf(host.color);
  const hostBackground = tokenOf(host.background ?? host["background-color"]);
  return rules.flatMap(({ selector, declarations }) => {
    const text = tokenOf(declarations.color);
    const background = tokenOf(declarations.background ?? declarations["background-color"]);
    if (!text && !background) return [];
    const backgrounds = background ? [background] : hostBackground ? [hostBackground] : SURFACES;
    return backgrounds.map((under) => ({
      selector,
      text: text ?? hostText ?? "--desk-text",
      background: under,
    }));
  });
}

describe("contrast", () => {
  it("is measured the WCAG way", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBe(1);
  });

  for (const [name, element] of Object.entries(elements)) {
    it(`${name} text reaches 4.5:1 under the default tokens`, () => {
      const found = pairs(element.styles);
      expect(found.length).toBeGreaterThan(0);
      const failing = found
        .map((pair) => ({
          ...pair,
          ratio: contrast(values[pair.text] ?? "", values[pair.background] ?? ""),
        }))
        .filter((pair) => !(pair.ratio >= 4.5));
      expect(failing).toEqual([]);
    });
  }
});
