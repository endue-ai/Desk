/**
 * `search.replace` from a plugin with several windows (ADR 0212). The core keeps one set of search
 * documents per plugin, and each window publishes what it holds (Notes its open notes), so one
 * window's set would drop the others'. The runtime keeps each window's last set and sends the core
 * all of them, the last published last; a window that closes while another stays takes its own away.
 * A plugin with one window publishes as it always did.
 */
import type { BridgeClient, BridgeRequest, SearchDocument } from "@endue-ai/bridge";
import { type PluginInstances, pluginOf } from "./instances";

/** The most documents the core takes from one plugin. */
const MOST = 500;

/** Documents the core could take: a set it would refuse is sent as it came, and kept by no one. */
const documentsOf = (request: BridgeRequest): SearchDocument[] | undefined => {
  if (request.method !== "search.replace") return undefined;
  const { documents } = (request.params ?? {}) as { documents?: unknown };
  const fine = (d: unknown) => typeof (d as SearchDocument | null)?.id === "string";
  return Array.isArray(documents) && documents.every(fine) ? documents : undefined;
};

export class WindowSearch {
  /** Each window's last published documents, oldest first. */
  readonly #sets = new Map<string, SearchDocument[]>();
  readonly #windows: Pick<PluginInstances, "of">;
  readonly #mounted: Pick<ReadonlyMap<string, unknown>, "has">;

  /** `windows` are the open windows and `mounted` the plugins on, as `PluginHost` keeps them. */
  constructor(
    windows: Pick<PluginInstances, "of">,
    mounted: Pick<ReadonlyMap<string, unknown>, "has">,
  ) {
    this.#windows = windows;
    this.#mounted = mounted;
  }

  /**
   * What window `key` sends for `request`, as its plugin: a `search.replace` carries every window's
   * documents.
   */
  call(key: string, request: BridgeRequest): [BridgeRequest, string] {
    const plugin = pluginOf(key);
    const documents = documentsOf(request);
    if (!documents) return [request, plugin];
    this.#sets.delete(key);
    this.#sets.set(key, documents);
    if (![...this.#sets.keys()].some((k) => k !== key && pluginOf(k) === plugin))
      return [request, plugin];
    return [{ ...request, params: { documents: this.#all(plugin) } } as BridgeRequest, plugin];
  }

  /** Window `key` closed: while another window of its plugin stays, the core drops its documents. */
  closed(key: string, bridge: Pick<BridgeClient, "call">): void {
    if (!this.#sets.delete(key)) return;
    const plugin = pluginOf(key);
    // A plugin turning off keeps its last documents in the core, as one window always did.
    if (!this.#mounted.has(plugin) || this.#windows.of(plugin).length === 0) {
      for (const k of [...this.#sets.keys()]) if (pluginOf(k) === plugin) this.#sets.delete(k);
      return;
    }
    const documents = this.#all(plugin);
    void bridge.call("search.replace", { documents }, { caller: plugin }).catch(() => {});
  }

  /** Every window's documents, one per id (the last published wins), at most the core's limit. */
  #all(plugin: string): SearchDocument[] {
    const byId = new Map<string, SearchDocument>();
    for (const [key, documents] of this.#sets) {
      if (pluginOf(key) !== plugin) continue;
      for (const document of documents) {
        byId.delete(document.id);
        byId.set(document.id, document);
      }
    }
    return [...byId.values()].slice(-MOST);
  }
}
