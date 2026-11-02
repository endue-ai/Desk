/**
 * The core on the browser stub, for dev pages and tests (never shipped): the command registry
 * (cmd.*, as the stub keeps it), the installed plugins from their plugin.json, plugin.setEnabled,
 * the store, init.yaml's start profile and settings, perm.query, and the stub's index of fixture items
 * (data.*, connector.*, view.*), and shell.open, which hands links to `open` (window.open on the dev
 * page) and only records reveals. The desk folder (`~/.desk`) is held in memory (`folder.ts`).
 * Built-in plugins hold their manifest's permissions, as the core grants them at install. brain.ask
 * answers through `ask` when given, and the theme market (theme.market.*, theme.import by url)
 * downloads through `download`. More methods come as handlers.
 */
import {
  type BrainTurnData,
  BridgeClient,
  type BridgeEvent,
  type BrowserStub,
  browserStub,
  type Item,
  type ItemSource,
  type PluginInfo,
  type PluginManifest,
  StubError,
  type StubHandlers,
  type StubOpened,
  stubCommands,
  type ThemeBundle,
  type ThemeIndex,
  type ThemeMarketListResult,
} from "@endue-ai/bridge";
import { themeHandlers } from "./core-themes";
import { type StubFolder, stubFolder } from "./folder";
import { searchHandlers } from "./search";

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
  /** The desk folder's files at start, by bridge path (`~/.desk/keys.yaml`). */
  files?: Record<string, string>;
  /** Hears the desk folder's files after every change, to keep them across a reload. */
  keepFiles?: (files: Record<string, string>) => void;
  /** Where shell.open's links go: a new window by default, nowhere without a window. */
  open?: (url: string) => void;
  /**
   * brain.ask's brain: the arguments it calls `tool` with for `prompt` (examples/brain-echo's
   * propose_theme in the fixtures), or undefined to answer in words. Without it brain.ask is not served.
   */
  ask?: (prompt: string, tool: string) => Record<string, unknown> | undefined;
  /**
   * The theme market's network: the bytes at an https URL (the fixture market, say). Without it
   * theme.market.list, theme.market.fetch and theme.import by url are not served.
   */
  download?: (url: string) => Promise<ArrayBuffer>;
}

export interface BrowserCore {
  client: BridgeClient;
  stub: BrowserStub;
  /** The desk folder (`~/.desk`) the runtime reads and writes, and the person edits by hand. */
  folder: StubFolder;
  /** plugin.list's answer, changed in place by plugin.setEnabled. */
  plugins: PluginInfo[];
  /** Put an item in the index, or replace it, as a sync would; subscribers hear data.changed. */
  upsert(item: Item): void;
  /** Take an item out of the index (false when it was not there); subscribers hear data.changed. */
  remove(source: ItemSource, id: string): boolean;
  /** Every shell.open the core let through, links and reveals, oldest first. */
  opened(): StubOpened[];
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
  const open = options.open ?? newWindow;
  const registry = stubCommands((event) => stub.emit(event), {
    grants,
    open: ({ target, reveal }) => {
      if (!reveal) open(target);
    },
  });
  const themes = themeHandlers(plugins, (event) => stub.emit(event));
  const served: StubHandlers = {
    ...registry.handlers,
    ...searchHandlers(plugins, store),
    ...themes,
    ...(options.download ? marketHandlers(options, plugins, themes, options.download) : {}),
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
    ...(options.ask ? { "brain.ask": brainAsk(options.ask, (event) => stub.emit(event)) } : {}),
    "init.get": () => ({
      profile: options.init?.profile ?? "default",
      settings: options.init?.settings ?? {},
      ...(options.init?.problem ? { problem: options.init.problem } : {}),
    }),
    ...options.handlers,
  };
  // The runtime's own files under ~/.desk; the rest of fs.* stays the page's.
  const emit = (event: BridgeEvent) => stub.emit(event);
  const desk = stubFolder(options.files ?? {}, emit, served, options.keepFiles);
  const stub = browserStub({ ...served, ...desk.handlers });
  return {
    client: new BridgeClient(stub),
    stub,
    folder: desk.folder,
    plugins,
    upsert: registry.upsert,
    remove: registry.remove,
    opened: () => registry.state().opened,
  };
}

/** brain.ask in memory: the turn starts and completes a moment after the answer names it. */
function brainAsk(
  answer: NonNullable<BrowserCoreOptions["ask"]>,
  emit: (event: BridgeEvent) => void,
): NonNullable<StubHandlers["brain.ask"]> {
  let asks = 0;
  return ({ prompt, tool }) => {
    const turnId = `a${++asks}`;
    const turn = (data: Omit<BrainTurnData, "turnId">) =>
      emit({ event: "brain.turn", data: { turnId, ...data } });
    setTimeout(() => {
      turn({ kind: "started" });
      const structured = answer(prompt, tool.name);
      turn(structured ? { kind: "completed", structured } : { kind: "completed", text: prompt });
    }, 0);
    return { turnId };
  };
}

/**
 * The theme market in memory: the indexes desk.theme.markets lists (init.yaml's, else desk.theme's
 * default) merged by id, the first winning; a theme is installed when plugin.list has it, and has an
 * update when its version differs. Downloads are checked against their sha256 as the core checks them.
 */
function marketHandlers(
  options: BrowserCoreOptions,
  plugins: PluginInfo[],
  themes: StubHandlers,
  download: (url: string) => Promise<ArrayBuffer>,
): StubHandlers {
  const text = async (url: string) => new TextDecoder().decode(await download(url));
  const checked = async (url: string, sha256: string): Promise<ThemeBundle> => {
    const bytes = await download(url);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== sha256)
      throw new StubError("invalid_params", `${url}: sha256 ${hex}, not ${sha256}`);
    return JSON.parse(new TextDecoder().decode(bytes)) as ThemeBundle;
  };
  const markets = (): string[] => {
    const own = options.init?.settings?.["desk.theme.markets"];
    const policy = options.manifests.find((m) => m.id === "desk.theme");
    const declared = policy?.contributes?.settings?.["desk.theme.markets"]?.default;
    const list = Array.isArray(own) ? own : Array.isArray(declared) ? declared : [];
    return list.filter((url): url is string => typeof url === "string");
  };
  const list = async (): Promise<ThemeMarketListResult> => {
    const result: ThemeMarketListResult = { themes: [], problems: [] };
    for (const market of markets()) {
      try {
        const index = JSON.parse(await text(market)) as ThemeIndex;
        if (index.format !== "desk-theme-index/1") throw new Error("not a theme index");
        for (const theme of index.themes) {
          if (result.themes.some((t) => t.theme.id === theme.id)) continue;
          const installed = plugins.find((p) => p.id === theme.id)?.manifest?.version;
          const state =
            installed === undefined
              ? "available"
              : installed === theme.version
                ? "installed"
                : "update";
          const url = new URL(theme.url, market).href;
          result.themes.push({
            theme: { ...theme, url },
            market,
            state,
            ...(installed ? { installed } : {}),
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.problems.push({ market, message });
      }
    }
    return result;
  };
  const importBundle = themes["theme.import"];
  return {
    "theme.market.list": list,
    "theme.market.fetch": async ({ url, sha256 }) => ({ bundle: await checked(url, sha256) }),
    "theme.import": async (params, caller) => {
      if (!importBundle) throw new StubError("unsupported", "theme.import is not served");
      if (!params.url) return importBundle(params, caller);
      const bundle = await checked(params.url, params.sha256 ?? "");
      return importBundle({ bundle, scope: params.scope }, caller);
    },
  };
}

/** A link in a new window, without a way back to this page; nothing where there is no window. */
function newWindow(url: string): void {
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}
