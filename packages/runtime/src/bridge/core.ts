/**
 * The core on the browser stub, for dev pages and tests (never shipped): the command registry
 * (cmd.*, as the stub keeps it), the installed plugins from their plugin.json, plugin.setEnabled,
 * the store, init.yaml's start profile and settings, and perm.query. More methods come as handlers.
 */
import {
  BridgeClient,
  type BrowserStub,
  browserStub,
  type PluginInfo,
  type PluginManifest,
  type StubHandlers,
  stubCommands,
} from "@endue-ai/bridge";

import { searchHandlers } from "./search";

/** What the core's store holds for the runtime: memory, or localStorage to survive a reload. */
export interface CoreStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface BrowserCoreOptions {
  /** The installed plugins; `desk.*` ones are built in. */
  manifests: PluginManifest[];
  /** Installed but turned off. */
  off?: Iterable<string>;
  store?: CoreStore;
  init?: { profile?: string; settings?: Record<string, unknown> };
  /** More methods (fs.write, ui.notify, ...), or the ones above answered differently. */
  handlers?: StubHandlers;
}

export interface BrowserCore {
  client: BridgeClient;
  stub: BrowserStub;
  /** plugin.list's answer, changed in place by plugin.setEnabled. */
  plugins: PluginInfo[];
}

/** An in-memory store over `data`, which tests may read. */
export function memoryStore(data: Record<string, unknown> = {}): CoreStore {
  return {
    get: (key) => (key in data ? structuredClone(data[key]) : undefined),
    set: (key, value) => {
      data[key] = structuredClone(value);
    },
  };
}

/** A store in localStorage under `prefix`, so a reload finds what the last page kept. */
export function localStore(prefix: string): CoreStore {
  return {
    get: (key) => {
      const raw = localStorage.getItem(prefix + key);
      return raw === null ? undefined : JSON.parse(raw);
    },
    set: (key, value) => localStorage.setItem(prefix + key, JSON.stringify(value)),
  };
}

export function browserCore(options: BrowserCoreOptions): BrowserCore {
  const off = new Set(options.off ?? []);
  const store = options.store ?? memoryStore();
  const plugins: PluginInfo[] = options.manifests.map((manifest) => ({
    id: manifest.id,
    status: "ready",
    enabled: !off.has(manifest.id),
    builtIn: manifest.id.startsWith("desk."),
    revision: 1,
    manifest,
  }));
  const registry = stubCommands((event) => stub.emit(event));
  const stub = browserStub({
    ...registry.handlers,
    ...searchHandlers(plugins, store),
    "perm.query": () => ({ grants: [] }),
    "plugin.list": () => ({ plugins: structuredClone(plugins) }),
    "plugin.setEnabled": ({ plugin, enabled }) => {
      const info = plugins.find((p) => p.id === plugin);
      if (!info) throw new Error(`no plugin ${plugin}`);
      info.enabled = enabled;
      // The core drops a plugin's commands when it is turned off.
      if (!enabled) registry.drop(plugin);
      queueMicrotask(() =>
        stub.emit({
          event: "plugin.changed",
          data: { plugin, change: enabled ? "enabled" : "disabled", revision: info.revision },
        }),
      );
      return { plugin: structuredClone(info) };
    },
    "store.get": ({ key }) => {
      const value = store.get(key);
      return value === undefined ? {} : { value };
    },
    "store.set": ({ key, value }) => {
      store.set(key, value);
      return {};
    },
    "init.get": () => ({
      profile: options.init?.profile ?? "default",
      settings: options.init?.settings ?? {},
    }),
    ...options.handlers,
  });
  return { client: new BridgeClient(stub), stub, plugins };
}
