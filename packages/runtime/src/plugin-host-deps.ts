/** What the plugin host (`plugins.ts`) is given: where plugin files load from, and the runtime. */
import type { BridgeClient, PluginInfo } from "@endue-ai/bridge";
import type { KeyLike } from "./input";
import type { SurfaceSpec } from "./surfaces";

export interface PluginHostOptions {
  /**
   * The URL of a plugin file: desk-plugin:// in the app (`deskPluginUrl`), a dev-server path in tests.
   * A mounted plugin's frame names its `surface`, so it loads on that surface's own host (#36,
   * `surfaceHost`); the files the desk loads itself (a theme's fonts) name none.
   */
  url(id: string, path: string, revision: number, surface?: string): string;
  /**
   * Native plugins (kind `native`) mount too: the compositor draws them from processes of their
   * own (#59). A desk without it (the windowed desk, tests) leaves them out.
   */
  native?: boolean;
}

/** What the host needs from the runtime. */
export interface PluginHostDeps {
  bridge: BridgeClient;
  win: Window;
  open(spec: SurfaceSpec): void;
  close(id: string): void;
  reload(id: string, src: string): void;
  frame(id: string): Window | null;
  /** Show or hide a plugin's surface (a palette shows itself when asked). */
  show?(id: string, visible: boolean): void;
  /** A key pressed inside a plugin's frame, for the desk's keymap. */
  key?(id: string, key: KeyLike): void;
  /** The installed plugins, each time they are listed (at start and after every plugin.changed). */
  listed?(plugins: PluginInfo[]): void;
  /** A frame reported its start: its first ready, or that it failed to start (ADR 0061). */
  outcome?(id: string, ok: boolean): void;
  /** Load a frame the runtime unloaded again (ADR 0070); true when its frame is live after. */
  wake?(id: string): boolean;
  /** False when a role the plugin provides went to another plugin (ADR 0104). */
  mayMount?(info: PluginInfo): boolean;
  /**
   * Of the plugins listed at start, those that start asleep (#590): mounted with their manifest's
   * commands but no surface, which opens on their first use. None when not given.
   */
  startAsleep?(plugins: PluginInfo[]): Promise<ReadonlySet<string>>;
}
