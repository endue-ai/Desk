// The DOM-free part of the package, safe to import in Node. The elements live at
// `@endue-ai/ui/elements`; the browser bundle (src/bundle.ts) carries both.
export { cssVariables, type ThemeTokens, tokens } from "./tokens";
export { tokensCss } from "./tokens-css";

export const NAME = "@endue-ai/ui";
