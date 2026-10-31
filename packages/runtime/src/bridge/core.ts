/**
 * The core on the browser stub, for dev pages and tests (never shipped): the command registry
 * (cmd.*, as the stub keeps it), the installed plugins from their plugin.json, plugin.setEnabled,
 * the store, init.yaml's start profile and settings, perm.query, and the stub's index of fixture items
 * (data.*, connector.*, view.*). Built-in plugins hold their manifest's permissions, as the core
 * grants them at install. More methods come as handlers.
 */
import {
  BridgeClient,
  type BrowserStub,
  browserStub,
  type Item,
  type ItemSource,
  type PluginInfo,
  type PluginManifest,
  type StubHandlers,
  stubCommands,
} from "@endue-ai/bridge";

/** What the core's store holds for the runtime: memory, or localStorage to survive a reload. */
export interface CoreStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface BrowserCoreOptions {
  /** The installed plugins; `desk.*` ones are built in. */
  manifests: PluginManifest[];
  /** Installed but turned off. Autoload plugins start off anyway, as the core starts them. */
  off?: Iterable<string>;
  store?: CoreStore;
  init?: { profile?: string; settings?: Record<string, unknown>; problem?: string };
  /** More methods (fs.write, ui.notify, ...), or the ones above answered differently. */
  handlers?: StubHandlers;
}

export interface BrowserCore {
  client: BridgeClient;
  stub: BrowserStub;
  /** plugin.list's answer, changed in place by plugin.setEnabled. */
  plugins: PluginInfo[];
  /** Put an item in the index, or replace it, as a sync would; subscribers hear data.changed. */
  upsert(item: Item): void;
  /** Take an item out of the index (false when it was not there); subscribers hear data.changed. */
  remove(source: ItemSource, id: string): boolean;
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
    enabled: !off.has(manifest.id) && manifest.autoload !== true,
    builtIn: manifest.id.startsWith("desk."),
    revision: 1,
    manifest,
  }));
  // A built-in plugin holds what its manifest declares, as desk-core grants it at install.
  const grants = Object.fromEntries(
    plugins.filter((p) => p.builtIn).map((p) => [p.id, p.manifest?.permissions ?? []]),
  );
  const registry = stubCommands((event) => stub.emit(event), { grants });
  const stub = browserStub({
    ...registry.handlers,
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
      ...(options.init?.problem ? { problem: options.init.problem } : {}),
    }),
    ...options.handlers,
  });
  return {
    client: new BridgeClient(stub),
    stub,
    plugins,
    upsert: registry.upsert,
    remove: registry.remove,
  };
}
