export {
  type BrowserStub,
  browserStub,
  type Invoke,
  type Listen,
  StubError,
  type StubHandlers,
  tauriAdapter,
} from "./adapters";
export * from "./brain.generated";
export {
  type BridgeAdapter,
  BridgeCallError,
  BridgeClient,
  type CallOptions,
  type ParamsOf,
  type ResultOf,
} from "./client";
export * from "./generated";
export { type StubCommands, stubCommands } from "./stub-commands";

export const NAME = "@endue-ai/bridge";
