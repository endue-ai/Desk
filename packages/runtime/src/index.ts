export { spreadCopy } from "./arrange/copy";
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
export type { Mode } from "./modes/types";
export { framePages } from "./pages/frames";
export {
  type RemotePages,
  type RemoteSurface,
  remotePages,
  type SurfaceTransport,
  surfaceHostOf,
} from "./pages/remote";
export type { SurfacePages } from "./pages/types";
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
export { viewTitles } from "./shell/titles";
export type { BrokenStateFile, StartInfo } from "./start";
export {
  type Opener,
  PAGE_NAME,
  popupOpener,
  type WindowPages,
  windowPages,
} from "./surface/window-pages";
export { SurfaceHost, type SurfaceSpec } from "./surfaces";
export { applyTheme } from "./theme";
export { PHASE_PREFIX, type Phase, phase, phases, timed } from "./timing";
export type { HostViews } from "./views";
export {
  answers,
  type Grab,
  heldWindows,
  noWindowManager,
  type WindowManagerHost,
  type WindowOp,
} from "./wm/host";
export { type LocalWindowManager, localWindowManager } from "./wm/local";
export type { Edit, Published, Told, WmDesk, WmView } from "./wm/types";

export const NAME = "@endue-ai/runtime";
