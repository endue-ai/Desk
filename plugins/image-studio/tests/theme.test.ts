import { expect, it } from "vitest";
import { lintPlugin } from "../../../scripts/ui-lint.mjs";

it("uses design tokens throughout the studio", () => {
  expect(lintPlugin("image-studio")).toEqual([]);
});
