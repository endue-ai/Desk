/**
 * What every policy module gets from the runtime: the hub (commands, settings, policies), the page,
 * the clock, the bridge and the hosts. Each module in this folder applies one desk.* policy.
 */
import type { BridgeClient } from "@endue-ai/bridge";
import type { Clock } from "../clock";
import type { PolicyHub } from "../hub";
import type { ShortcutRouter } from "../input";
import type { SurfaceHost } from "../surfaces";

export interface DeskContext {
  hub: PolicyHub;
  root: HTMLElement;
  win: Window;
  clock: Clock;
  bridge: BridgeClient;
  shortcuts: ShortcutRouter;
  surfaces: SurfaceHost;
  /** Keep a message for every plugin: sent now and after each plugin's init (the theme, say). */
  share(message: { type: string; [field: string]: unknown }): void;
  /** Ask a running plugin and wait for its answer; rejects when it is not running. */
  request(plugin: string, command: string, args?: unknown): Promise<unknown>;
  /** Whether a plugin's surface is mounted now. */
  mounted(plugin: string): boolean;
  /** Resolves once a mounted plugin has connected; rejects if it stops first or none is mounted. */
  whenReady(plugin: string): Promise<void>;
  /** Take a plugin's surface away for the rest of this session. */
  unmount(plugin: string): void;
}

/** A policy module, installed once; dispose undoes what it bound. */
export interface Installed {
  dispose(): void;
}

/** Collects the functions that undo what a module bound. */
export function disposer(): { add(off: () => void): void; dispose(): void } {
  const offs: Array<() => void> = [];
  return {
    add: (off) => void offs.push(off),
    dispose: () => {
      for (const off of offs.splice(0).reverse()) off();
    },
  };
}
