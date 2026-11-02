import { describe, expect, it } from "vitest";
import { lintPlugin } from "../../../scripts/ui-lint.mjs";

describe("the theme", () => {
  it("reads every colour, font, size, radius and duration from the theme", () => {
    expect(lintPlugin("docs")).toEqual([]);
  });
});
