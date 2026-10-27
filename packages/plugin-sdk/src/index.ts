export type {
  BridgeEvent,
  BridgeMethod,
  BridgeRequest,
  BridgeResponse,
  ParamsOf,
  ResultOf,
} from "@endue-ai/bridge";
export { BridgeCallError } from "@endue-ai/bridge";
export { type HostMessage, type PluginMessage, type Transport, windowTransport } from "./protocol";
export {
  connect,
  defineUiPlugin,
  type PluginBridge,
  type PluginCommands,
  type PluginContext,
  type PluginState,
  type PluginSurface,
  type UiPlugin,
} from "./sdk";

export const NAME = "@endue-ai/plugin-sdk";
