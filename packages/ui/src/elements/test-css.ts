// Reading the elements' shadow CSS in tests: flat rules (no nesting; the rules inside an at-rule
// block such as @media or @keyframes read as flat rules too) and the WCAG 2 contrast ratio.

export type Rule = { selector: string; declarations: Record<string, string> };

/** The rules of a flat style sheet, in order. */
export function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  for (const [, selector = "", body = ""] of css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations: Record<string, string> = {};
    for (const declaration of body.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon > 0) {
        declarations[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
      }
    }
    rules.push({ selector: selector.trim(), declarations });
  }
  return rules;
}

/** The custom property a value reads when it is exactly `var(--name)`, else undefined. */
export function tokenOf(value: string | undefined): string | undefined {
  return value?.match(/^var\((--[a-z-]+)\)$/)?.[1];
}

/** The WCAG 2 contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
