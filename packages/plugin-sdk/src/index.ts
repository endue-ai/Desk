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
  UniversalData,
  UniversalEntry,
  UniversalSource,
  UniversalType,
  UniversalView,
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
export type {
  DeskData,
  DeskPath,
  DraggableOptions,
  DragImage,
  DragKeys,
  DragOver,
  DragResult,
  DragStart,
  Drop,
  DropAnswer,
  DropEffect,
  DropHandler,
  DropOptions,
  DropTarget,
  PluginDnd,
  PointerLike,
} from "./dnd/types";
export { DRAG_THRESHOLD, draggable } from "./drag";
export {
  type ByteSource,
  byteSource,
  type FileRef,
  type ReadBytesOptions,
  readBytes,
} from "./files";
export {
  type FileHistoryOptions,
  type FsRestoreResult,
  type FsVersion,
  fileHistory,
  restoreFile,
} from "./history";
export {
  fitFiles,
  type KeepFilesOptions,
  type KeptFile,
  type KeptFiles,
  type KeptState,
  keepFiles,
  type OpenFile,
} from "./open-files";
export {
  type CommandOutcome,
  type FollowHandlers,
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
export {
  applyTextChange,
  isTextChange,
  type TextChange,
  textChange,
  textSum,
} from "./text-change";
export {
  fillArgs,
  type PluginUniversal,
  type UniversalHandle,
  type UniversalOpenOptions,
  type UniversalViewElement,
} from "./universal";
export {
  assetUrl,
  entriesFromItems,
  parseUniversal,
  UniversalError,
  universalData,
} from "./universal-load";
export { startWorker } from "./worker";
export { parseYaml, YamlError } from "./yaml";

export const NAME = "@endue-ai/plugin-sdk";

export type { SearchDocument, SearchHit } from "@endue-ai/bridge";
export type { PluginSearch } from "./search";
