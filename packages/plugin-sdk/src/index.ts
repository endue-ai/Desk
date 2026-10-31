export type {
  BridgeEvent,
  BridgeMethod,
  BridgeRequest,
  BridgeResponse,
  DataReadPermission,
  EventName,
  Grant,
  GrantDuration,
  Item,
  ItemChange,
  ItemKind,
  ItemPage,
  ItemQuery,
  ItemSource,
  LogEntry,
  LogLevel,
  ParamsOf,
  Permission,
  PermRequestResult,
  ResultOf,
  Setting,
  SurfacePlacement,
  View,
  ViewComponent,
  ViewNode,
  ViewSummary,
} from "@endue-ai/bridge";
export { BridgeCallError } from "@endue-ai/bridge";
export { CommandFailed, type CommandInfo, type PluginCommands } from "./commands";
export type {
  PluginEvents,
  PluginLog,
  PluginPerm,
  PluginSettings,
  SurfaceOptions,
} from "./context";
export { type PluginData, type PluginViews, readScope } from "./data";
export {
  type ByteSource,
  byteSource,
  type FileRef,
  type ReadBytesOptions,
  readBytes,
} from "./files";
export {
  type CommandOutcome,
  type HostMessage,
  isDeskKey,
  type KeyPress,
  type PluginMessage,
  type ThemeState,
  type Transport,
  windowTransport,
} from "./protocol";
export {
  connect,
  defineUiPlugin,
  type PluginBridge,
  type PluginContext,
  type PluginState,
  type PluginSurface,
  type PluginTheme,
  type UiPlugin,
} from "./sdk";
export { startWorker } from "./worker";

export const NAME = "@endue-ai/plugin-sdk";
