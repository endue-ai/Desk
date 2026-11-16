/**
 * A plugin's microphone ends with its page (ADR 0245): when one of a plugin's windows closes, its
 * frame loads again or is unloaded out of sight, nothing of the page that started a capture is left
 * to stop it, so the runtime stops every capture that plugin holds. It follows `audio.capturing`,
 * which only the runtime hears, and stops as the runtime, which may stop any capture.
 */
import type { BridgeClient } from "@endue-ai/bridge";
import { pluginOf } from "./instances";

type Bridge = Pick<BridgeClient, "call" | "onEvent">;

export interface PluginMic {
  /** Window or frame `key` went away: its plugin's captures stop. */
  gone(key: string): void;
  /** `act` on a window or frame key, once that key's plugin's captures are stopped. */
  ending<A extends unknown[]>(
    act: (key: string, ...rest: A) => void,
  ): (key: string, ...rest: A) => void;
  /** `host`, whose `unloaded` stops the plugin's captures first; the same object for the same host. */
  host<H extends { unloaded(id: string, state: unknown): void }>(
    host: H | undefined,
  ): H | undefined;
  dispose(): void;
}

export function pluginMic(bridge: Bridge): PluginMic {
  let captures: readonly { captureId: string; caller: string }[] = [];
  const off = bridge.onEvent((event) => {
    if (event.event === "audio.capturing") captures = event.data.captures;
  });
  const gone = (key: string) => {
    const plugin = pluginOf(key);
    for (const { captureId, caller } of captures) {
      if (caller !== plugin) continue;
      const scope = { permission: "audio:capture" } as const;
      void bridge.call("audio.capture.stop", { captureId, scope }).catch(() => {});
    }
  };
  const wrapped = new WeakMap<object, unknown>();
  return {
    gone,
    ending:
      (act) =>
      (key, ...rest) => {
        gone(key);
        act(key, ...rest);
      },
    host(host) {
      if (!host) return undefined;
      const known = wrapped.get(host);
      if (known) return known as typeof host;
      const proxy = new Proxy(host, {
        get(target, key) {
          if (key === "unloaded") {
            return (id: string, state: unknown) => {
              gone(id);
              target.unloaded(id, state);
            };
          }
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      wrapped.set(host, proxy);
      return proxy;
    },
    dispose: off,
  };
}
