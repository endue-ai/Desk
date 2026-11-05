import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintPlugin } from "../../../scripts/ui-lint.mjs";

const ui = join(import.meta.dirname, "../ui");

describe("the theme", () => {
  it("reads every colour, font, size, radius and duration from the theme", () => {
    // The page links the desk's tokens and its own sheets, which the lint then reads.
    const page = readFileSync(join(ui, "index.html"), "utf8");
    for (const sheet of ["/_desk/tokens.css", "./style.css", "./views.css", "./time.css"]) {
      expect(page).toContain(`href="${sheet}"`);
      if (sheet.startsWith("./")) expect(existsSync(join(ui, sheet)), sheet).toBe(true);
    }
    expect(lintPlugin("projects")).toEqual([]);
  });
});
