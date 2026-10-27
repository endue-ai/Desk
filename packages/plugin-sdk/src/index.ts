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
  type PluginContext,
  type PluginState,
  type UiPlugin,
} from "./sdk";

export const NAME = "@endue-ai/plugin-sdk";
