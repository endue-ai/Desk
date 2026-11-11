// What keeps each view inside its window at the first sizes (402×305, 643×339; #160). A unit test has
// no layout, so this reads the rules that do it from the stylesheets; the view tests check the DOM
// they act on, and the live app the pixels.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sheet = (name: string) => readFileSync(join(import.meta.dirname, "../ui", name), "utf8");
/** Both sheets without comments and without at-rules (@media, @container): the rules always in force. */
const css = `${sheet("style.css")}\n${sheet("editor.css")}`
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/@[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");

/** The declarations of every rule whose selector list is exactly `selector`, merged. */
function rule(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, head = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (head.replace(/\s+/g, " ").trim() !== selector) continue;
    for (const declaration of body.split(";")) {
      const [name, ...value] = declaration.split(":");
      if (name?.trim() && value.length) found[name.trim()] = value.join(":").trim();
    }
  }
  return found;
}

describe("what keeps a view inside its window", () => {
  it("a month chip is never wider than its day: the cell's one column is as wide as the cell", () => {
    expect(rule(".month .events")).toMatchObject({
      "grid-template-columns": "minmax(0, 1fr)",
      "container-type": "inline-size",
    });
    expect(rule(".event")).toMatchObject({ "min-width": "0", overflow: "hidden" });
    expect(rule(".event .title")).toMatchObject({ "text-overflow": "ellipsis" });
  });

  it("a block flows its title, then its time, in lines it cuts at its bottom", () => {
    expect(rule(".block")).toMatchObject({ "flex-flow": "row wrap", "container-type": "size" });
  });

  it("the heading keeps to one line beside the bar's buttons", () => {
    expect(rule("h1")).toMatchObject({
      "min-width": "0",
      "white-space": "nowrap",
      "text-overflow": "ellipsis",
    });
  });

  it("only the event form's fields scroll; its title and its actions stay in view", () => {
    expect(rule("dialog")).toMatchObject({ overflow: "hidden", padding: "0" });
    expect(rule("dialog[open]")).toMatchObject({ display: "flex", "flex-direction": "column" });
    expect(rule(".fields")).toMatchObject({ "min-height": "0", "overflow-y": "auto" });
    expect(rule(".editor-foot")).toMatchObject({ flex: "none" });
  });
});
