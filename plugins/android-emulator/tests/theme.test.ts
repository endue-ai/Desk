import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { lintPlugin } from "../../../scripts/ui-lint.mjs";

it("uses the Desk theme for the emulator workspace", () => {
  const page = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8");
  expect(page).toContain('href="/_desk/tokens.css"');
  expect(page).toContain('href="/_desk/base.css"');
  expect(lintPlugin("android-emulator")).toEqual([]);
});
