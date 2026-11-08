// @endue-ai/ui/theme: compile a theme block into tokens and gate it for contrast (ADR 0056, ADR 0057),
// and start a palette from an image's main colours (TS-09).
// DOM-free, so the runtime, the studio, tests and tools share one copy; not in the frames' ui.js.
export { contrast, formatColor, fromOklch, over, parseColor, type Rgba, toOklch } from "./color";
export {
  type CompiledTheme,
  cleanTokens,
  compileTheme,
  type Scheme,
  type ThemeFontFace,
} from "./compile";
export { type ExtractOptions, extractColors, type Pixels, type Swatch } from "./extract";
export {
  type Gated,
  type GateFix,
  type GateOptions,
  gate,
  NON_TEXT_PAIRS,
  reach,
  TEXT_PAIRS,
} from "./gate";
export { type BrandPalette, paletteFrom } from "./palette";
export { DENSITY, MOTION, RADIUS, RANGES, SHADOW } from "./presets";
