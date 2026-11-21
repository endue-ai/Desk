// NF-05: every colour the database plugin draws can be read in the desk's light and dark schemes.
// Text reaches 4.5:1 and marks (a bar, a dot, an underline, a ring, a line of the diagram) 3:1
// (WCAG 1.4.3, 1.4.11) on what is under them: the rule's own background when it sets one (a tint is
// laid over each neutral surface), else every neutral surface a page of the plugin shows. Every
// rule of every sheet under ui/ is measured, so a colour that is added is measured with it, and
// one that cannot be worked out fails. The pattern is another built-in plugin's contrast test
// (plugins/*/tests/contrast.test.ts); the rendered page's walk is
// packages/runtime/e2e/database-contrast.spec.ts.
import { describe, expect, it } from "vitest";
import { contrast, over, type Rgba } from "../../../packages/ui/src/theme/index";
import { type Paint, Palette, painted, pluginRules, type Rule, scheme } from "./contrast-css";

/** The surfaces under a colour whose rule sets no background: the theme gate's surfaces. */
const NEUTRAL = ["background", "card", "muted", "popover", "hover"];

/**
 * Rules whose colours sit on one known surface instead: the editor's text, its caret and its
 * highlights are drawn on the editor (`#editor-box .cm-editor`, the page's background).
 */
const ON: Array<[RegExp, string[]]> = [
  [/^\.tok-/, ["background"]],
  [
    /^#editor-box \.cm-(content|line|cursor|selection|searchMatch|matchingBracket|nonmatchingBracket|placeholder|gutters|fold)/,
    ["background"],
  ],
];

/**
 * The text a surface without a colour of its own carries: the body's. Other text on it (a NULL in a
 * found cell, a token under the editor's selection) is a rule of its own, measured on its surface,
 * and the rendered page's walk measures it where it is drawn.
 */
const INHERITED = "var(--desk-text)";

/** Declarations left out, each with why. An entry that matches nothing fails. */
const EXEMPT: Record<string, string> = {
  'body[data-running="false"] .cancel | opacity':
    "Cancel is inactive while nothing runs: WCAG 1.4.3 leaves inactive controls out",
};

const TEXT = new Set(["color", "-webkit-text-fill-color"]);
const BACKGROUND = new Set(["background", "background-color"]);
const MARK =
  /^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|box-shadow|stroke|caret-color|text-decoration(-color)?|column-rule(-color)?)$/;
/** Drawn outside the box, over what is around it: an outline, a shadow that is not inset. */
const OUTSIDE = (prop: string, value: string) =>
  prop.startsWith("outline") || (prop === "box-shadow" && !/\binset\b/.test(value));
/**
 * Dividers and gaps draw structure, not meaning: the design system keeps a divider under 3:1 on
 * purpose, and a border in a surface's colour is the gap between two blocks.
 */
const DIVIDER = /^var\(--desk-(border|background|card|muted|popover)\)$/;
/** A tint's edge (`--desk-warning-border` round `--desk-warning-soft`): the text in it carries it. */
const EDGE = /^var\(--desk-[a-z]+-border\)$/;
/** A chosen cell, row or item. */
const CHOSEN = /\.chosen\b|\[aria-selected(="true")?\]/;
/** The design system's selection surfaces (rule 4: selection is a surface, never a fill). */
const SELECTION = /^var\(--desk-(hover|primary-soft)\)$/;

interface Colour {
  prop: string;
  expr: string;
  paints: Paint[];
  outside: boolean;
}
interface Ground {
  label: string;
  rgba: Rgba;
}

const named = (expr: string, p: Paint) => (p.via.length ? `${expr} (${p.via.join(", ")})` : expr);

/** Every colour of every rule measured in a scheme: what fails, and the rules measured. */
function measure(name: "light" | "dark", rules: Rule[], used: Set<string>) {
  const palette = new Palette(scheme(name), rules);
  const failing: string[] = [];
  const measured = new Set<string>();
  const card = (palette.paints("var(--desk-card)") ?? [])[0]?.rgba ?? [0, 0, 0, 1];
  const ground = (token: string): Ground => {
    const [paint] = palette.paints(`var(--desk-${token})`) ?? [];
    if (!paint) throw new Error(`--desk-${token} is not a colour in ${name}`);
    return { label: token, rgba: over(paint.rgba, card) };
  };
  for (const rule of rules) {
    const where = `${rule.file} ${rule.selector}`;
    const exempt = (prop: string) => {
      const key = `${rule.selector} | ${prop}`;
      if (key in EXEMPT) used.add(key);
      return key in EXEMPT;
    };
    const grounds = (ON.find(([re]) => re.test(rule.selector))?.[1] ?? NEUTRAL).map(ground);
    const tinted = rule.decls.some(
      ([prop, value]) => BACKGROUND.has(prop) && palette.surface(value) && value !== "transparent",
    );
    const texts: Colour[] = [];
    const marks: Colour[] = [];
    const fills: Colour[] = [];
    let surfaces: Ground[] = [];
    let opacity = 1;
    for (const [prop, value] of rule.decls) {
      if (exempt(prop)) continue;
      if (prop === "opacity") {
        const o = Number.parseFloat(value);
        if (o > 0 && o < 1) opacity = o;
        continue;
      }
      const isFill = prop === "fill";
      if (!TEXT.has(prop) && !BACKGROUND.has(prop) && !MARK.test(prop) && !isFill) continue;
      let parts: ReturnType<typeof painted>;
      try {
        parts = painted(prop, value, palette);
      } catch (error) {
        failing.push(`${where} ${prop}: ${(error as Error).message}`);
        continue;
      }
      for (const part of parts ?? []) {
        const colour = { prop, ...part, outside: OUTSIDE(prop, value) };
        const surface = palette.surface(part.expr);
        if ((BACKGROUND.has(prop) || isFill) && surface) {
          for (const p of part.paints)
            for (const g of grounds)
              surfaces.push({
                label: `${named(part.expr, p)} on ${g.label}`,
                rgba: over(p.rgba, g.rgba),
              });
        } else if (BACKGROUND.has(prop)) fills.push(colour);
        else if (TEXT.has(prop) || isFill) texts.push(colour);
        else if (
          !DIVIDER.test(part.expr) &&
          !(EDGE.test(part.expr) && prop.startsWith("border") && tinted)
        )
          marks.push(colour);
      }
    }
    // A solid fill under text is that text's ground (a filled badge); alone it is a mark (a bar, a dot).
    if (fills.length > 0 && texts.length > 0)
      surfaces = fills.flatMap((f) =>
        f.paints.flatMap((p) =>
          grounds.map((g) => ({ label: named(f.expr, p), rgba: over(p.rgba, g.rgba) })),
        ),
      );
    else marks.push(...fills);
    if (texts.length === 0 && (surfaces.length > 0 || opacity < 1))
      texts.push({
        prop: "color (inherited)",
        expr: INHERITED,
        paints: palette.paints(INHERITED) ?? [],
        outside: false,
      });
    const check = (role: "text" | "mark", list: Colour[], need: number) => {
      for (const { prop, expr, paints, outside } of list) {
        const under = outside
          ? grounds
          : surfaces.length > 0
            ? [...surfaces, ...(role === "mark" ? grounds : [])]
            : grounds;
        for (const p of paints)
          for (const g of under) {
            const ratio = contrast([p.rgba[0], p.rgba[1], p.rgba[2], p.rgba[3] * opacity], g.rgba);
            measured.add(rule.selector);
            if (!(ratio >= need))
              failing.push(
                `${where} ${prop} ${named(expr, p)} on ${g.label}: ${ratio.toFixed(2)} (${role} ${need}:1)`,
              );
          }
      }
    };
    check("text", texts, 4.5);
    check("mark", marks, 3);
    // A chosen state with no mark of its own shows on the design system's selection surface.
    if (CHOSEN.test(rule.selector) && marks.length === 0)
      for (const [prop, value] of rule.decls)
        if (BACKGROUND.has(prop) && !SELECTION.test(value))
          failing.push(
            `${where} ${prop} ${value}: a chosen state without a 3:1 mark is on --desk-hover`,
          );
  }
  return { failing, measured };
}

describe("the database plugin's colours (NF-05)", () => {
  const rules = pluginRules();
  const used = new Set<string>();
  const results = { light: measure("light", rules, used), dark: measure("dark", rules, used) };

  for (const name of ["light", "dark"] as const)
    it(`reach 4.5:1 as text and 3:1 as marks in the ${name} scheme`, () => {
      expect(results[name].failing).toEqual([]);
    });

  it("measure the tokens, tags, band, diff, plan marks, connection colours and diagram lines", () => {
    const named = [
      ".tok-keyword",
      ".tok-function",
      ".tok-string",
      ".tok-number",
      ".tok-comment",
      ".tok-name",
      ".tok-param",
      '.tag[class*="tag-"]',
      'body[data-tag="production"]',
      ".cell.changed",
      ".grid-row.inserted .cell",
      ".grid-row.deleted .cell",
      "#changes",
      ".plan-mark.mark-high",
      ".plan-mark.mark-medium",
      ".hot-high .plan-bar",
      ".swatch",
      'body[data-color^="chart-"] header',
      ".er-link",
      ".er-key",
    ];
    for (const name of ["light", "dark"] as const)
      expect(
        named.filter((s) => !results[name].measured.has(s)),
        name,
      ).toEqual([]);
  });

  it("keeps no exemption that matches no declaration", () => {
    expect(Object.keys(EXEMPT).filter((key) => !used.has(key))).toEqual([]);
  });
});
