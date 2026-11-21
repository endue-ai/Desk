/**
 * A plugin's microphone ends with its page (ADR 0245): when one of a plugin's windows closes, or its
 * frame loads again (the runtime's reload, or the shell's of a page that stopped painting, #378), is
 * unloaded out of sight or is stopped (`frames/install.ts`), nothing of the page that started a
 * capture is left to stop it, so the runtime stops every capture that plugin holds. It follows `audio.capturing`, which only the runtime hears, and stops as the runtime, which
 * may stop any capture.
 */
import type { BridgeClient } from "@endue-ai/bridge";
import { pluginOf } from "./instances";

type Bridge = Pick<BridgeClient, "call" | "onEvent">;

export interface PluginMic {
  /** Window or frame `key` went away: its plugin's captures stop. */
  gone(key: string): void;
  dispose(): void;
}

export function pluginMic(bridge: Bridge): PluginMic {
  let captures: readonly { captureId: string; caller: string }[] = [];
  const off = bridge.onEvent((event) => {
    if (event.event === "audio.capturing") captures = event.data.captures;
  });
  const scope = { permission: "audio:capture" } as const;
  return {
    gone(key) {
      const plugin = pluginOf(key);
      for (const { captureId, caller } of captures) {
        if (caller !== plugin) continue;
        void bridge.call("audio.capture.stop", { captureId, scope }).catch(() => {});
      }
    },
    dispose: off,
  };
}
