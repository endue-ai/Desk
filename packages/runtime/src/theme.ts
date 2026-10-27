import { cssVariables, type ThemeTokens, tokens } from "@endue-ai/ui";

/** Apply theme tokens as CSS custom properties on `root` (CSSOM, so a strict CSP still allows it). */
export function applyTheme(root: HTMLElement, theme: ThemeTokens = tokens): void {
  for (const [name, value] of Object.entries(cssVariables(theme))) {
    root.style.setProperty(name, value);
  }
}
