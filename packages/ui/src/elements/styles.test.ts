import { describe, expect, it } from "vitest";
import { cssVariables } from "../tokens";
import { elements } from "./index";
import { parseRules } from "./test-css";

const known = new Set(Object.keys(cssVariables()));
// Properties that take a colour, and what may sit next to a token in them.
const COLOURED =
  /^(color|background(-color)?|border(-[a-z]+)?(-color)?|outline(-color)?|box-shadow)$/;
const PLAIN = /^(-?[\d.]+(px|%|em|rem)?|solid|none|inherit|transparent|currentcolor|inset)$/i;

describe("element styles", () => {
  it("cover the six elements", () => {
    expect(Object.keys(elements)).toEqual([
      "desk-button",
      "desk-input",
      "desk-list",
      "desk-dialog",
      "desk-menu",
      "desk-toast",
    ]);
  });

  for (const [name, element] of Object.entries(elements)) {
    const rules = parseRules(element.styles);

    it(`${name} names colours only through --desk-* tokens`, () => {
      expect(element.styles).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(element.styles).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i);
      for (const { selector, declarations } of rules) {
        for (const [property, value] of Object.entries(declarations)) {
          if (!COLOURED.test(property)) continue;
          const rest = value.replace(/var\(--desk-[a-z-]+\)/g, " ").trim();
          for (const word of rest.split(/\s+/).filter(Boolean)) {
            expect(word, `${selector} { ${property}: ${value} }`).toMatch(PLAIN);
          }
        }
      }
    });

    it(`${name} reads only tokens that tokens.ts defines`, () => {
      const used = [...element.styles.matchAll(/var\((--[a-z-]+)/g)].map((match) => match[1]);
      expect(used.length).toBeGreaterThan(0);
      for (const property of used) expect(known).toContain(property);
    });

    it(`${name} draws a visible focus ring in the accent`, () => {
      const rings = rules.filter(
        (rule) =>
          rule.selector.includes(":focus-visible") &&
          rule.declarations.outline === "2px solid var(--desk-accent)",
      );
      expect(rings.length).toBeGreaterThan(0);
    });
  }
});
