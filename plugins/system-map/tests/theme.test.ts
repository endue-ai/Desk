import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { lintPlugin } from "../../../scripts/ui-lint.mjs";

it("uses theme tokens for the hierarchy and details", () => {
  const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
  expect(html).toContain('href="/_desk/tokens.css"');
  expect(html).toContain('href="/_desk/base.css"');
  expect(lintPlugin("system-map")).toEqual([]);
});
