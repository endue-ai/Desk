import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintPlugin } from "../../../scripts/ui-lint.mjs";

const ui = join(import.meta.dirname, "../ui");

describe("the inspector's theme", () => {
  it("loads the desk's tokens and reads every colour, font, size, radius and duration from them", () => {
    const page = readFileSync(join(ui, "index.html"), "utf8");
    expect(page).toContain('href="/_desk/tokens.css"');
    expect(readFileSync(join(ui, "style.css"), "utf8")).toContain("var(--desk-");
    expect(lintPlugin("inspector")).toEqual([]);
  });
});
