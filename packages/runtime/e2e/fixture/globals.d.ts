import type { BrowserStub } from "@endue-ai/bridge";
import type { ManualClock, Runtime } from "../../src/index";

declare global {
  interface Window {
    /** Test handle installed by the fixture pages only. */
    __desk: { clock: ManualClock; runtime: Runtime; stub: BrowserStub; commands: string[] };
    /** The onboarding fixture's in-memory store.get/store.set backing. */
    __deskStore: Record<string, unknown>;
    /** The desk fixture's fs.write calls, in order. */
    __deskWritten: Array<{ path: string; content: string }>;
  }
}
