import type { BridgeEvent, BridgeRequest } from "@endue-ai/bridge";
import type { KeyLike } from "./input";

export type PluginMessage =
  | { type: "desk:hello" }
  | { type: "desk:calls"; calls: BridgeRequest[] }
  | { type: "desk:state"; state: unknown }
  | { type: "desk:close" }
  | { type: "desk:visible"; visible: boolean }
  | {
      type: "desk:reply";
      call: number;
      ok: boolean;
      result?: unknown;
      error?: { code: string; message: string };
    }
  | { type: "desk:key"; key: KeyLike }
  | { type: "desk:ready" }
  | { type: "desk:failed"; message?: string };

/** The callers the core addressed an event to, or undefined for everyone. */
export function recipientsOf(event: BridgeEvent): string[] | undefined {
  const to = (event as { to?: unknown }).to;
  return Array.isArray(to) ? to.filter((id): id is string => typeof id === "string") : undefined;
}
