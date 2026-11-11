// What keeps the tree in view at small windows (#162 findings 8 and 9: at the first size, 326x169 at
// 1280x800, the header's two rows, the column names and the preview left the tree no height at all;
// at 300x220 half a row). A unit test has no layout, so this reads the rules that do it from the
// stylesheet; the live app checks the pixels.
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

describe("at small windows the tree comes first", () => {
  const small = block("(max-width: 720px), (max-height: 480px)");

  it("the header is one thin line that scrolls sideways with no bar of its own", () => {
    expect(rule(small, "header")).toMatchObject({
      "flex-wrap": "nowrap",
      "overflow-x": "auto",
      "scrollbar-width": "none",
    });
    expect(rule(small, ".actions")).toMatchObject({
      "flex-wrap": "nowrap",
      "--desk-field-height": "var(--desk-control-xs)",
      "--desk-button-height": "var(--desk-control-xs)",
    });
    // The format and path give way; the name says them on hover.
    expect(rule(small, "#archive-about")).toMatchObject({ display: "none" });
    // The column names are one row of the tree high.
    expect(rule(small, ".columns")).toMatchObject({
      "--desk-button-height": "var(--archives-row)",
    });
  });

  it("up to 300 px high the counts give way, and in a narrow window the preview too", () => {
    expect(rule(block("(max-height: 300px)"), "#summary")).toMatchObject({ display: "none" });
    const narrow = block("(max-width: 640px) and (max-height: 300px)");
    expect(rule(narrow, "#preview")).toMatchObject({ display: "none" });
    expect(rule(narrow, "main")).toMatchObject({ "grid-template-rows": "minmax(0, 1fr)" });
  });
});
