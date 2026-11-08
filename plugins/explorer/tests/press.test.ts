import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "../ui/style.css"), "utf8");
/** The declarations of the rule whose selector list is exactly `selectors`. */
const rule = (selectors: string) => {
  const at = css.indexOf(`${selectors} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

describe("a press on a row is a click", () => {
  it("never selects the tree's or the header's text, in WebKit too", () => {
    // WebKit (WKWebView, WebKitGTK) ignores the unprefixed property: the name painted selected.
    const block = rule("header,\n#tree");
    expect(block).toContain("-webkit-user-select: none;");
    expect(block).toContain("user-select: none;");
    expect(block).toContain("-webkit-user-drag: none;");
  });

  it("keeps the preview and the status line selectable", () => {
    expect(rule("#preview")).not.toContain("user-select");
    expect(rule("#status")).not.toContain("user-select");
  });
});
