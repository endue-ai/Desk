import type { BridgeEvent, BridgeRequest, BridgeResponse } from "@endue-ai/bridge";

/** Messages a plugin frame sends to the runtime. */
export type PluginMessage =
  | { type: "desk:hello" }
  | { type: "desk:calls"; calls: BridgeRequest[] }
  | { type: "desk:state"; state: unknown };

/** Messages the runtime sends to a plugin frame. */
export type HostMessage =
  | { type: "desk:init"; pluginId: string; state: unknown }
  | { type: "desk:results"; results: Array<{ id: number; response: BridgeResponse }> }
  | { type: "desk:event"; event: BridgeEvent };

/** How the SDK talks to its host: postMessage in a frame, memory in tests. */
export interface Transport {
  send(message: PluginMessage): void;
  listen(handler: (message: HostMessage) => void): () => void;
}

const HOST_TYPES = new Set(["desk:init", "desk:results", "desk:event"]);

/** The frame transport: messages go to the parent window and only the parent is heard. */
export function windowTransport(win: Window = window): Transport {
  return {
    send: (message) => win.parent.postMessage(message, "*"),
    listen: (handler) => {
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: unknown } | null;
        if (event.source !== win.parent || typeof data?.type !== "string") return;
        if (HOST_TYPES.has(data.type)) handler(data as HostMessage);
      };
      win.addEventListener("message", onMessage);
      return () => win.removeEventListener("message", onMessage);
    },
  };
}
