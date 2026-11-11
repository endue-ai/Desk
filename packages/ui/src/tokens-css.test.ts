import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cssVariables, tokensCss } from "./index";
import { NATIVE_CSS } from "./native-css";

const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").trim();

describe("tokensCss", () => {
  it("is one :root rule holding every default token, then the engine's parts' rules", () => {
    const css = uncommented(tokensCss());
    const end = css.indexOf("\n}\n");
    const lines = css.slice(0, end + 2).split("\n");
    expect(lines[0]).toBe(":root {");
    expect(lines.at(-1)).toBe("}");
    const declared = Object.fromEntries(
      lines.slice(1, -1).map((line) => {
        const match = /^ {2}(--desk-[a-z0-9-]+): (.+);$/.exec(line);
        expect(match, line).not.toBeNull();
        return [match?.[1], match?.[2]];
      }),
    );
    expect(declared).toEqual(cssVariables());
    // Every page links this sheet, so it brings the theme's scheme and scrollbars too (#156).
    expect(uncommented(css.slice(end + 3))).toBe(uncommented(NATIVE_CSS));
  });

  it("starts with a GENERATED header", () => {
    expect(tokensCss()).toMatch(/^\/\* GENERATED /);
  });

  it("is what src/tokens.css holds, the committed copy the shell imports", () => {
    const committed = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
    expect(
      committed,
      "regenerate: pnpm --filter @endue-ai/ui build, copy dist/tokens.css to src",
    ).toBe(tokensCss());
  });
});
