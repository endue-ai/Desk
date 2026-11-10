export { type BrowserBridge, browserBridge, type Envelope } from "./bridge/browser";
export {
  type BrowserCore,
  browserCore,
  type CoreStore,
  localStore,
  memoryStore,
} from "./bridge/core";
export type {
  AccountStatus,
  AudioLevels,
  Bands,
  BrainStatus,
  BrainStep,
  LocalAgentEvent,
  LocalAgentsBridge,
  LocalAsk,
  LocalSessionQuery,
  ShellBridge,
  StudioShellBridge,
} from "./bridge/types";
export { type Clock, ManualClock, realClock, type Tween, tween } from "./clock";
// The floating Eris over the OS (ADR 0121): its view, and the link that hands her state between it
// and the desk.
export {
  BACK_KEY,
  type ErisLine,
  type ErisSnapshot,
  type FloatStatus,
  type LinkChannel,
  pairedChannels,
  SNAPSHOT_KEY,
  storageChannel,
} from "./eris/float";
export { type ErisFloat, type FloatHost, mountErisFloat } from "./eris/float-view";
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
export { deskPluginUrl, pluginLabel, surfaceHost } from "./plugin-origins";
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
export { type WmDesk, wmDesk, wmTitles } from "./shell/wm-desk";
export type { BrokenStateFile, StartInfo } from "./start";
export type { KeptWindows } from "./surface/host";
export { SurfaceHost, type SurfaceSpec } from "./surfaces";
export { applyTheme } from "./theme";
export { PHASE_PREFIX, type Phase, phase, phases, timed } from "./timing";
export type { HostViews } from "./views";

export const NAME = "@endue-ai/runtime";
