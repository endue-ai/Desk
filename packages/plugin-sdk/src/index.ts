export type {
  BridgeEvent,
  BridgeMethod,
  BridgeRequest,
  BridgeResponse,
  ParamsOf,
  ResultOf,
} from "@endue-ai/bridge";
export { BridgeCallError } from "@endue-ai/bridge";
export { CommandFailed, type CommandInfo, type PluginCommands } from "./commands";
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

export const NAME = "@endue-ai/plugin-sdk";
