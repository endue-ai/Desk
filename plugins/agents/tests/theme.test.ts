import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintTarget } from "../../../scripts/ds-lint.mjs";
import { lintPlugin } from "../../../scripts/ui-lint.mjs";

const ui = join(import.meta.dirname, "../ui");

describe("the theme and the design system", () => {
  it("reads every colour, font, size, radius and duration from the theme", () => {
    const page = readFileSync(join(ui, "index.html"), "utf8");
    const sheets = [
      "/_desk/tokens.css",
      "/_desk/base.css",
      "./style.css",
      "./views.css",
      "./studio.css",
    ];
    for (const sheet of sheets) {
      expect(page).toContain(`href="${sheet}"`);
      if (sheet.startsWith("./")) expect(existsSync(join(ui, sheet)), sheet).toBe(true);
    }
    expect(lintPlugin("agents")).toEqual([]);
  });

  it("draws every control as a design system component", () => {
    expect(lintTarget({ name: "agents", dirs: ["plugins/agents/ui"] })).toEqual([]);
  });
});
