// What keeps the sheet in view at a window's first sizes (400×263, and the 326×169 page of the first
// window at 1280×800; #162 finding 8). A unit test has no layout, so this reads the rules that do it
// from the stylesheet; the page tests check the attributes they act on, and the live app the pixels.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "../ui/style.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The body of the `@media` block with exactly this query, or the sheet without any at-rule. */
function block(query?: string): string {
  if (!query) return source.replace(/@[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const at = source.indexOf(`@media ${query} {`);
  if (at < 0) return "";
  let depth = 0;
  for (let i = source.indexOf("{", at); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0)
      return source.slice(source.indexOf("{", at) + 1, i);
  }
  return "";
}

/** The declarations of every rule in `css` whose selector list holds `selector`, merged. */
function rule(css: string, selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, head = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = head.split(",").map((s) => s.replace(/\s+/g, " ").trim());
    if (!selectors.includes(selector)) continue;
    for (const declaration of body.split(";")) {
      const [name, ...value] = declaration.split(":");
      if (name?.trim() && value.length) found[name.trim()] = value.join(":").trim();
    }
  }
  return found;
}

describe("the header keeps to one line", () => {
  const always = block();
  it("never wraps: the name and the format are cut with an ellipsis", () => {
    expect(rule(always, "header")).toMatchObject({ display: "flex", "min-width": "0" });
    expect(rule(always, "header")["flex-wrap"]).toBeUndefined();
    for (const part of ["#book-name", "#book-detail"])
      expect(rule(always, part)).toMatchObject({
        "min-width": "0",
        "white-space": "nowrap",
        "text-overflow": "ellipsis",
      });
  });

  it("the format gives way first, then the tier, then the name; the unsaved mark never", () => {
    const shrink = (selector: string) => Number(rule(always, selector).flex?.split(" ")[1]);
    expect(shrink("#book-detail")).toBeGreaterThan(shrink("header desk-edit-tier"));
    expect(shrink("header desk-edit-tier")).toBeGreaterThan(shrink("#book-name"));
    expect(rule(always, "#book-mark")).toMatchObject({ flex: "none" });
  });
});

describe("at the first sizes the sheet comes first", () => {
  it("up to 420 px high a one-sheet book has no tab row and the chrome is thin", () => {
    const first = block("(max-height: 420px)");
    expect(rule(first, ".tabs[data-single]")).toMatchObject({ display: "none" });
    expect(rule(first, "header")).toMatchObject({ padding: "4px 10px 2px" });
    // The formula bar's field and a workbook's tabs at the design system's smallest control height.
    expect(rule(first, ".formula")).toMatchObject({
      "--desk-field-height": "var(--desk-control-xs)",
    });
    expect(rule(first, ".tabs")).toMatchObject({ "--desk-tab-height": "var(--desk-control-xs)" });
    expect(rule(first, "footer")).toMatchObject({ padding: "2px 10px 3px" });
  });

  it("up to 240 px high the format, the tier and the tabs go, and the name and the unsaved mark stay", () => {
    const small = block("(max-height: 240px)");
    for (const part of ["#book-detail", "header desk-edit-tier", ".tabs"])
      expect(rule(small, part)).toMatchObject({ display: "none" });
    expect(rule(small, "header").display).toBeUndefined();
    expect(rule(small, "#book-mark").display).toBeUndefined();
    expect(rule(small, "h1").display).toBeUndefined();
  });
});
