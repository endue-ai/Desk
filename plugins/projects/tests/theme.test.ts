import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintTarget } from "../../../scripts/ds-lint.mjs";
import { lintPlugin } from "../../../scripts/ui-lint.mjs";

const ui = join(import.meta.dirname, "../ui");
const SHEETS = ["./style.css", "./views.css", "./time.css", "./small.css"];

describe("the theme", () => {
  it("reads every colour, font, size, radius and duration from the theme", () => {
    // The page links the desk's tokens and its own sheets, which the lint then reads.
    const page = readFileSync(join(ui, "index.html"), "utf8");
    for (const sheet of ["/_desk/tokens.css", "/_desk/base.css", ...SHEETS]) {
      expect(page).toContain(`href="${sheet}"`);
      if (sheet.startsWith("./")) expect(existsSync(join(ui, sheet)), sheet).toBe(true);
    }
    expect(lintPlugin("projects")).toEqual([]);
  });

  it("draws its controls as the design system's, and fills nothing with the input border's colour", () => {
    expect(lintTarget({ name: "projects", dirs: ["plugins/projects/ui"] })).toEqual([]);
    for (const sheet of SHEETS) {
      const css = readFileSync(join(ui, sheet), "utf8");
      expect(css, sheet).not.toMatch(/background[^;{}]*var\(--desk-input\)/);
    }
  });
});
