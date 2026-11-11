// What keeps the file in view at small windows (#162 finding 9: at 300x220 the tree and the raw
// text were one row high under a header that was a scroll bar). A unit test has no layout, so this
// reads the rules that do it from the stylesheet; the page tests check the attributes they act on,
// and the live app the pixels (326x169: the panes went from 24 to 110 px).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "../ui/style.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The body of the `@media` block with exactly this query. */
function block(query: string): string {
  const at = source.indexOf(`@media ${query} {`);
  if (at < 0) return "";
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
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

describe("at small windows the file comes first", () => {
  const small = block("(max-width: 720px), (max-height: 480px)");

  it("the header is one thin line that scrolls sideways with no bar of its own", () => {
    expect(rule(small, "header")).toMatchObject({
      "flex-wrap": "nowrap",
      "overflow-x": "auto",
      "scrollbar-width": "none",
    });
    expect(rule(small, "#toolbar")).toMatchObject({
      "--desk-field-height": "var(--desk-control-xs)",
      "--desk-button-height": "var(--desk-control-xs)",
      "--desk-tab-height": "var(--desk-control-xs)",
    });
    for (const part of ["#path", "#expand-all", "#collapse-all"])
      expect(rule(small, part)).toMatchObject({ display: "none" });
  });

  it("up to 300 px high the pointer line and a panel with nothing to act on give way", () => {
    const first = block("(max-height: 300px)");
    for (const part of ["#where", "#problems[data-quiet]"])
      expect(rule(first, part)).toMatchObject({ display: "none" });
    expect(rule(first, "#problems")).toMatchObject({ "max-height": "3.5em" });
  });
});
