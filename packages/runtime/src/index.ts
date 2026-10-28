export { type Clock, ManualClock, realClock, type Tween, tween } from "./clock";
export { comboOf, type KeyLike, type Platform, ShortcutRouter } from "./input";
export {
  type Cell,
  defaultLayout,
  LAYOUT_KEY,
  type Layout,
  type LayoutStorage,
  loadLayout,
  move,
  place,
  remove,
  saveLayout,
} from "./layout";
export { PluginHost, type PluginHostDeps, type PluginHostOptions } from "./plugins";
export { createRuntime, type Runtime, type RuntimeOptions, type RuntimePlugins } from "./runtime";
export { SurfaceHost, type SurfaceSpec } from "./surfaces";
export { applyTheme } from "./theme";

export const NAME = "@endue-ai/runtime";
