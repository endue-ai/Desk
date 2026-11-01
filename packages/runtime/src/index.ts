export { type BrowserBridge, browserBridge, type Envelope } from "./bridge/browser";
export {
  type BrowserCore,
  browserCore,
  type CoreStore,
  localStore,
  memoryStore,
} from "./bridge/core";
export type { AudioLevels, Bands, BrainStatus, ShellBridge } from "./bridge/types";
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
export type { Mode } from "./modes/types";
export { PluginHost, type PluginHostDeps, type PluginHostOptions } from "./plugins";
export {
  createRuntime,
  type Runtime,
  type RuntimeOptions,
  type RuntimePlugins,
  type RuntimeProfiles,
} from "./runtime";
export type { SettingsLanguage } from "./settings-ui/copy";
export type { SettingsSection } from "./settings-ui/panels";
export type { SettingsWindow } from "./settings-ui/window";
export { type Desk, type DeskOptions, mountDesk } from "./shell/Desk";
export { SurfaceHost, type SurfaceSpec } from "./surfaces";
export { applyTheme } from "./theme";
export type { HostViews } from "./views";

export const NAME = "@endue-ai/runtime";
