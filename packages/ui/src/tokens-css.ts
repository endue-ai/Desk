import { cssVariables, type ThemeTokens, tokens } from "./tokens";

/** The tokens as one `:root` rule: what the build writes to `dist/tokens.css`. */
export function tokensCss(theme: ThemeTokens = tokens): string {
  const lines = Object.entries(cssVariables(theme)).map(([name, value]) => `  ${name}: ${value};`);
  return `/* @endue-ai/ui default tokens, generated from src/tokens.ts. */\n:root {\n${lines.join("\n")}\n}\n`;
}
