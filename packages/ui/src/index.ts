// The DOM-free part of the package, safe to import in Node. The elements live at
// `@endue-ai/ui/elements`; the browser bundle (src/bundle.ts) carries both.
export {
  type ColorTokens,
  colors,
  cssVariables,
  type MaterialTokens,
  MOTION_TOKENS,
  material,
  propertyOf,
  type ScaleTokens,
  scale,
  type TerminalTokens,
  type ThemeTokens,
  terminal,
  tokens,
} from "./tokens";
export { tokensCss } from "./tokens-css";

export const NAME = "@endue-ai/ui";
