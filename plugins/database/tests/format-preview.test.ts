// @vitest-environment jsdom
// The Format SQL preview's panel (ui/features/format/): the style in force in words, the sample as
// Format laid it out in a block of its own the keyboard reaches, and a hint of what changes it.
import { describe, expect, it } from "vitest";
import { previewView, styleWords } from "../ui/features/format/panel.js";
import { STYLE } from "../ui/sql/layout/style.js";

describe("the Format SQL preview", () => {
  it("draws the style in words and the sample as laid out", () => {
    const panel = previewView(document, { text: "SELECT a\nFROM t", style: STYLE });
    expect(panel.getAttribute("aria-label")).toBe("Format SQL preview");
    expect(panel.querySelector(".format-style")?.textContent).toBe(
      "PostgreSQL: keywords in upper case · indent 4 · width 80 · commas last · AND and OR before · joins under FROM · a clause a line when it fits · lists indented.",
    );
    const sample = panel.querySelector("pre.format-sample");
    expect(sample?.textContent).toBe("SELECT a\nFROM t");
    expect(sample?.getAttribute("tabindex")).toBe("0");
    expect(
      styleWords({
        ...STYLE,
        keywordCase: "preserve",
        comma: "first",
        andOr: "after",
        joins: "indented",
        oneLine: "item",
        lists: "align",
      }),
    ).toBe(
      "keywords as typed · indent 4 · width 80 · commas first · AND and OR after · joins indented · an item a line · lists aligned",
    );
  });
});
