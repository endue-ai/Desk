import type { BrowserStub } from "@endue-ai/bridge";
import type { ManualClock, Runtime } from "../../src/index";

declare global {
  interface Window {
    /** Test handle installed by the fixture page only. */
    __desk: { clock: ManualClock; runtime: Runtime; stub: BrowserStub; commands: string[] };
  }
}
