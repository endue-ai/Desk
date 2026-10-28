import type { BridgeClient, BridgeEvent, BridgeRequest, PluginInfo } from "@endue-ai/bridge";
import type { SurfaceSpec } from "./surfaces";

export interface PluginHostOptions {
  /** The URL of a plugin file: desk-plugin:// in the app, a dev-server path in tests. */
  url(id: string, path: string, revision: number): string;
}

/** What the host needs from the runtime. */
export interface PluginHostDeps {
  bridge: BridgeClient;
  win: Window;
  open(spec: SurfaceSpec): void;
  close(id: string): void;
  reload(id: string, src: string): void;
  frame(id: string): Window | null;
}

type PluginMessage =
  | { type: "desk:hello" }
  | { type: "desk:calls"; calls: BridgeRequest[] }
  | { type: "desk:state"; state: unknown }
  | { type: "desk:close" };

const MANAGE = { permission: "plugin:manage" } as const;

/**
 * Mounts UI plugins on surfaces and carries their bridge calls. Plugins are told apart by the
 * frame a message comes from, so a plugin can only ever call as itself.
 */
export class PluginHost {
  readonly #deps: PluginHostDeps;
  readonly #options: PluginHostOptions;
  readonly #mounted = new Map<string, PluginInfo>();
  readonly #state = new Map<string, unknown>();
  #offEvents: (() => void) | undefined;

  constructor(deps: PluginHostDeps, options: PluginHostOptions) {
    this.#deps = deps;
    this.#options = options;
  }

  async start(): Promise<void> {
    this.#deps.win.addEventListener("message", this.#onMessage);
    this.#offEvents = this.#deps.bridge.onEvent((event) => this.#onEvent(event));
    for (const info of await this.#list()) this.#mount(info);
  }

  mounted(): string[] {
    return [...this.#mounted.keys()];
  }

  /** Deliver a command to a mounted plugin (`ctx.commands.on(name, handler)` in the SDK). */
  command(id: string, name: string, args?: unknown): void {
    if (this.#mounted.has(id)) this.#post(id, { type: "desk:command", name, args });
  }

  stop(): void {
    this.#deps.win.removeEventListener("message", this.#onMessage);
    this.#offEvents?.();
    for (const id of this.mounted()) this.#unmount(id);
  }

  async #list(): Promise<PluginInfo[]> {
    const { plugins } = await this.#deps.bridge.call("plugin.list", { scope: MANAGE });
    return plugins;
  }

  #mount(info: PluginInfo): void {
    const manifest = info.manifest;
    if (info.status !== "ready" || !info.enabled || manifest?.kind !== "ui") return;
    if (this.#mounted.has(info.id)) return;
    const surface = manifest.surfaces?.[0];
    this.#mounted.set(info.id, info);
    this.#deps.open({
      id: info.id,
      title: surface?.title ?? manifest.name ?? info.id,
      src: this.#options.url(info.id, manifest.entry, info.revision),
      ...(surface?.placement ? { placement: surface.placement } : {}),
    });
  }

  #unmount(id: string): void {
    if (!this.#mounted.delete(id)) return;
    this.#deps.close(id);
  }

  #onEvent(event: BridgeEvent): void {
    if (event.event !== "plugin.changed") return;
    this.#broadcast(event);
    const { plugin, change, revision } = event.data;
    const info = this.#mounted.get(plugin);
    switch (change) {
      case "updated":
        if (info?.manifest) {
          const next = { ...info, revision };
          this.#mounted.set(plugin, next);
          this.#deps.reload(plugin, this.#options.url(plugin, info.manifest.entry, revision));
        }
        break;
      case "disabled":
      case "removed":
        this.#unmount(plugin);
        break;
      case "enabled":
      case "installed":
        void this.#list().then((all) => {
          const fresh = all.find((p) => p.id === plugin);
          if (fresh) this.#mount({ ...fresh, enabled: true });
        });
        break;
    }
  }

  /** plugin.changed goes to plugins that manage plugins, like the sidebar. */
  #broadcast(event: BridgeEvent): void {
    for (const [id, info] of this.#mounted) {
      const manages = info.manifest?.permissions?.some((p) => p.permission === "plugin:manage");
      if (manages) this.#post(id, { type: "desk:event", event });
    }
  }

  #post(id: string, message: unknown): void {
    this.#deps.frame(id)?.postMessage(message, "*");
  }

  readonly #onMessage = (event: MessageEvent): void => {
    const id = this.mounted().find((candidate) => this.#deps.frame(candidate) === event.source);
    if (!id) return;
    const message = event.data as PluginMessage;
    switch (message?.type) {
      case "desk:hello":
        this.#post(id, { type: "desk:init", pluginId: id, state: this.#state.get(id) });
        break;
      case "desk:state":
        this.#state.set(id, message.state);
        break;
      case "desk:close":
        // The plugin is done with its surface for this session (the first run, for example).
        this.#unmount(id);
        break;
      case "desk:calls":
        void Promise.all(
          message.calls.map(async (request) => ({
            id: request.id,
            response: await this.#deps.bridge.forward(request, id),
          })),
        ).then((results) => this.#post(id, { type: "desk:results", results }));
        break;
    }
  };
}
