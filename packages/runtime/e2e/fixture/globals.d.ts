import type { BrowserStub, Item, ItemSource, PluginInfo } from "@endue-ai/bridge";
import type { BrowserBridge, Envelope } from "../../src/bridge/browser";
import type { ManualClock, Runtime } from "../../src/index";
import type { Desk } from "../../src/shell/Desk";

declare global {
  interface Window {
    /** Test handle installed by the fixture pages only. */
    __desk: { clock: ManualClock; runtime: Runtime; stub: BrowserStub; commands: string[] };
    /** The onboarding fixture's in-memory store.get/store.set backing. */
    __deskStore: Record<string, unknown>;
    /** The shell fixture's handle (shell.html). */
    __shell: {
      desk: Desk;
      clock: ManualClock;
      bridge: BrowserBridge;
      step(ms: number): void;
      envelopes: { user: Envelope; eris: Envelope };
    };
    /** The desk fixture's fs.write calls, in order. */
    __deskWritten: Array<{ path: string; content: string }>;
    /** The edges fixture's plugin.list, to change before emitting plugin.changed. */
    __deskPlugins: PluginInfo[];
    /** The views fixture (views.html): its views saved, example.jira's runs, the index changed. */
    __views: {
      ready: Promise<void>;
      invoked: Array<{ id: string; args: unknown; caller: string }>;
      upsert(item: Item): void;
      remove(source: ItemSource, id: string): boolean;
    };
  }
}
