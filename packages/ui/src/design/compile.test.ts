import { describe, expect, it } from "vitest";
import { TEXT_PAIRS } from "../theme/gate";
import { tokens } from "../tokens";
import { COMPONENTS, compileDesignSystem, componentTokens, optionsOf, propertiesOf } from "./index";

const VAR = /var\(--desk-([a-z0-9-]+)\)/g;
const tokenOf = (property: string) =>
  property.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Every recipe that sets one property to one option, the rest at the defaults. */
function* everyChoice(): Generator<Record<string, Record<string, string>>> {
  for (const component of COMPONENTS) {
    for (const property of propertiesOf(component)) {
      for (const option of optionsOf(component, property)) {
        yield { [component]: { [property]: option } };
      }
    }
  }
}

describe("compileDesignSystem", () => {
  it("gives the endue design system today's look", () => {
    expect(componentTokens).toMatchObject({
      buttonRadius: "var(--desk-radius-md)",
      buttonHeight: "var(--desk-control-sm)",
      buttonPrimaryBg: "var(--desk-primary)",
      buttonPrimaryFg: "var(--desk-primary-foreground)",
      buttonBorder: "var(--desk-input)",
      fieldBorderColor: "var(--desk-input)",
      fieldHeight: "var(--desk-control-md)",
      tabSelectedBg: "var(--desk-primary-soft)",
      dialogRadius: "var(--desk-radius-lg)",
      dialogScrimFilter: "blur(8px)",
      focusWidth: "2px",
    });
  });

  it("names the same tokens for every recipe, each a known token reference or a bounded constant", () => {
    const names = Object.keys(componentTokens).sort();
    for (const recipe of everyChoice()) {
      const compiled = compileDesignSystem(recipe);
      expect(Object.keys(compiled).sort()).toEqual(names);
      for (const [name, value] of Object.entries(compiled)) {
        expect(value, name).not.toMatch(/url\(|[;{}<>]/);
        for (const [, ref] of value.matchAll(VAR))
          expect(tokens, `${name}: ${ref}`).toHaveProperty(tokenOf(ref ?? ""));
      }
    }
  });

  it("pairs text with grounds only as the theme gate checks them", () => {
    const pairs = new Set(TEXT_PAIRS.map(([text, ground, layer]) => `${text}/${layer ?? ground}`));
    const ok = (fg: string, bg: string) => {
      const text = tokenOf(fg.replace(/^var\(--desk-|\)$/g, ""));
      if (bg === "transparent") return pairs.has(`${text}/card`) || pairs.has(`${text}/background`);
      return pairs.has(`${text}/${tokenOf(bg.replace(/^var\(--desk-|\)$/g, ""))}`);
    };
    for (const recipe of everyChoice()) {
      const t = compileDesignSystem(recipe);
      const checks: Array<[string, string]> = [];
      for (const prefix of ["button", "buttonPrimary", "buttonDanger", "buttonQuiet"]) {
        checks.push([`${prefix}Fg`, `${prefix}Bg`], [`${prefix}HoverFg`, `${prefix}HoverBg`]);
      }
      checks.push(
        ["tabSelectedFg", "tabSelectedBg"],
        ["toastFg", "toastBg"],
        ["badgeFg", "badgeBg"],
      );
      checks.push(["rowActiveFg", "rowActiveBg"], ["iconButtonFg", "iconButtonBg"]);
      for (const [fg, bg] of checks) {
        const pair = `${t[fg]} on ${t[bg]}`;
        expect(ok(t[fg] as string, t[bg] as string), `${JSON.stringify(recipe)} ${pair}`).toBe(
          true,
        );
      }
    }
  });

  it("changes only what a recipe names", () => {
    const sharp = compileDesignSystem({ button: { shape: "none", case: "uppercase" } });
    expect(sharp.buttonRadius).toBe("0");
    expect(sharp.buttonCase).toBe("uppercase");
    expect(sharp.fieldRadius).toBe(componentTokens.fieldRadius);
    const underline = compileDesignSystem({ field: { style: "underline", shape: "full" } });
    expect(underline.fieldBorderWidth).toBe("0 0 1px");
    expect(underline.fieldRadius).toBe("0");
    const soft = compileDesignSystem({ button: { primary: "soft" } });
    expect(soft.buttonPrimaryBg).toBe("var(--desk-primary-soft)");
    expect(soft.buttonDangerFg).toBe("var(--desk-danger-text)");
  });
});
