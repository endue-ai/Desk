import type { SearchDocument } from "@endue-ai/bridge";
import type { PluginBridge } from "./sdk";

/** Publish only content the person should find in global search. Private store values stay private. */
export interface PluginSearch {
  /** Atomically replace this plugin's index (up to 500 documents / 4 MiB); [] clears it. */
  replace(documents: SearchDocument[]): Promise<void>;
}

export function searchFor(bridge: PluginBridge): PluginSearch {
  let pending: Promise<void> = Promise.resolve();
  return {
    replace(documents) {
      const snapshot = structuredClone(documents);
      const next = pending.then(async () => {
        await bridge.call("search.replace", { documents: snapshot });
      });
      pending = next.catch(() => {});
      return next;
    },
  };
}
