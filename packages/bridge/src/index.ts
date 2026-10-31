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
export {
  FIXTURE_CONNECTOR,
  FIXTURE_NOW,
  type FixtureConnector,
  fixtureConnector,
  fixtureItems,
} from "./fixtures";
export * from "./generated";
export {
  type StubCommands,
  type StubOptions,
  type StubState,
  type StubSurface,
  stubCommands,
} from "./stub-commands";
export { mediaType, pathMatch, type StubFiles, stubFs } from "./stub-fs";

export const NAME = "@endue-ai/bridge";
