// @endue-ai/ui/design: the design system's catalogue and compiler (ADR 0090). A design system picks, per
// component, named options; compileDesignSystem turns them into --desk-<component>-* tokens over the
// theme's. DOM-free, so the runtime, the studio, tests and tools share one copy.
export {
  CATALOGUE,
  type Catalogue,
  COMPONENTS,
  type ComponentName,
  type ComponentRecipe,
  type DesignRecipe,
  defaultOf,
  defaultRecipe,
  type FullRecipe,
  fillRecipe,
  mergeRecipe,
  type OptionOf,
  optionsOf,
  type PropertyName,
  propertiesOf,
  trimRecipe,
  VOCABULARY,
} from "./catalogue";
export { compileDesignSystem, componentTokens } from "./compile";
