import { describe, expect, it } from "vitest";
import { cssVariables, tokensCss } from "./index";

describe("tokensCss", () => {
  it("is one :root rule holding every default token, and nothing else", () => {
    const css = tokensCss()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    const lines = css.split("\n");
    expect(lines[0]).toBe(":root {");
    expect(lines.at(-1)).toBe("}");
    const declared = Object.fromEntries(
      lines.slice(1, -1).map((line) => {
        const match = /^ {2}(--desk-[a-z-]+): (#[0-9a-f]{6});$/.exec(line);
        expect(match, line).not.toBeNull();
        return [match?.[1], match?.[2]];
      }),
    );
    expect(declared).toEqual(cssVariables());
  });
});
