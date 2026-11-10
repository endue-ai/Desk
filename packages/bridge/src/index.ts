export { type BrowserStub, browserStub, StubError, type StubHandlers } from "./adapters";
export * from "./brain.generated";
export {
  type CefHost,
  cefAdapter,
  cefHost,
  type DeskNative,
  deskNative,
  type Invoke,
  type Listen,
} from "./cef";
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
export { type StubOpened, shellLink } from "./stub-shell";
export {
  anyViewProblems,
  isPage,
  isUniversal,
  pageProblems,
  universalProblems,
} from "./stub-universal";
export { viewProblems } from "./stub-views";
export * from "./surface.generated";

export const NAME = "@endue-ai/bridge";
