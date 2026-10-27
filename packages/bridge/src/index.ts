export {
  type BrowserStub,
  browserStub,
  type Invoke,
  type Listen,
  type StubHandlers,
  tauriAdapter,
} from "./adapters";
export * from "./brain.generated";
export {
  type BridgeAdapter,
  BridgeCallError,
  BridgeClient,
  type ParamsOf,
  type ResultOf,
} from "./client";
export * from "./generated";

export const NAME = "@endue-ai/bridge";
