import type {
  BridgeClient,
  BridgeEvent,
  BridgeRequest,
  BridgeResponse,
  Permission,
  PluginInfo,
} from "@endue-ai/bridge";
import { CommandError } from "./commands";
import type { KeyLike } from "./input";
import { eventKey, Owners } from "./owners";
import { PluginCommands } from "./plugin-commands";
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
  /** Show or hide a plugin's surface (a palette shows itself when asked). */
  show?(id: string, visible: boolean): void;
  /** A key pressed inside a plugin's frame, for the desk's keymap. */
  key?(id: string, key: KeyLike): void;
  /** The installed plugins, each time they are listed (at start and after every plugin.changed). */
  listed?(plugins: PluginInfo[]): void;
}

type Reply = {
  call: number;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};

type PluginMessage =
  | { type: "desk:hello" }
  | { type: "desk:calls"; calls: BridgeRequest[] }
  | { type: "desk:state"; state: unknown }
  | { type: "desk:close" }
  | { type: "desk:visible"; visible: boolean }
  | ({ type: "desk:reply" } & Reply)
  | { type: "desk:key"; key: KeyLike };

const MANAGE = { permission: "plugin:manage" } as const;

/** The callers the core addressed an event to (`to` on the Tauri payload), or undefined for everyone. */
function recipientsOf(event: BridgeEvent): string[] | undefined {
  const to = (event as { to?: unknown }).to;
  return Array.isArray(to) ? to.filter((id): id is string => typeof id === "string") : undefined;
}

/**
 * Mounts UI plugins on surfaces and carries their bridge calls. Plugins are told apart by the
 * frame a message comes from, so a plugin can only ever call as itself.
 */
export class PluginHost {
  readonly #deps: PluginHostDeps;
  readonly #options: PluginHostOptions;
  readonly #mounted = new Map<string, PluginInfo>();
  readonly #state = new Map<string, unknown>();
  /** Turns, watches, data subscriptions and processes, by the plugin whose call started them. */
  readonly #owners = new Owners();
  /** Commands delivered to plugins that wait for their reply, by call id. */
  readonly #pending = new Map<
    number,
    { plugin: string; resolve(v: unknown): void; reject(e: unknown): void }
  >();
  #nextCall = 1;
  readonly #shared = new Map<string, unknown>();
  /** Plugins that said hello since they mounted, and callers waiting for one that has not yet. */
  readonly #greeted = new Set<string>();
  readonly #waiting = new Map<string, Array<{ resolve(): void; reject(e: unknown): void }>>();
  readonly #commands: PluginCommands;
  #offEvents: (() => void) | undefined;

  constructor(deps: PluginHostDeps, options: PluginHostOptions) {
    this.#deps = deps;
    this.#options = options;
    this.#commands = new PluginCommands(deps.bridge);
  }

  async start(): Promise<void> {
    this.#deps.win.addEventListener("message", this.#onMessage);
    this.#offEvents = this.#deps.bridge.onEvent((event) => this.#onEvent(event));
    const all = await this.#list();
    this.#deps.listed?.(all);
    for (const info of all) this.#mount(info);
  }

  /** Launch an installed UI plugin, including one put away or disabled by the person. */
  async launch(id: string, waitForReady = false): Promise<void> {
    let info = (await this.#list()).find((p) => p.id === id);
    if (info?.status !== "ready" || info.manifest?.kind !== "ui")
      throw new Error(`No launchable plugin ${id}`);
    if (!info.enabled) {
      ({ plugin: info } = await this.#deps.bridge.call("plugin.setEnabled", {
        plugin: id,
        enabled: true,
        scope: MANAGE,
      }));
    }
    this.#mount(info);
    if (waitForReady) await this.whenReady(id);
    this.#deps.show?.(id, true);
  }

  mounted(): string[] {
    return [...this.#mounted.keys()];
  }

  /** Send a mounted plugin a message by name (`ctx.commands.on(name, handler)` in the SDK). */
  command(id: string, name: string, args?: unknown): void {
    if (this.#mounted.has(id)) this.#post(id, { type: "desk:command", name, args });
  }

  /**
   * Ask one plugin something and wait for its answer, like desk.files.visit. These requests are not
   * registry commands: only the desk sends them, to the one plugin they are about.
   */
  request(id: string, name: string, args?: unknown): Promise<unknown> {
    if (!this.#mounted.has(id))
      return Promise.reject(new CommandError("unknown_command", `${id} is not running`));
    const call = this.#nextCall++;
    return new Promise((resolve, reject) => {
      this.#pending.set(call, { plugin: id, resolve, reject });
      this.#post(id, { type: "desk:command", name, args, call });
    });
  }

  /** Resolves once a mounted plugin has connected (said hello); rejects if it stops first. */
  whenReady(id: string): Promise<void> {
    if (this.#greeted.has(id)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiting = this.#waiting.get(id) ?? [];
      waiting.push({ resolve, reject });
      this.#waiting.set(id, waiting);
    });
  }

  /** Take a plugin's surface away for the rest of this session, as `desk:close` does. */
  unmount(id: string): void {
    this.#unmount(id);
  }

  /** Keep a message for every plugin, like the theme: sent now, and after each plugin's init. */
  share(message: { type: string; [field: string]: unknown }): void {
    this.#shared.set(message.type, message);
    for (const id of this.#mounted.keys()) this.#post(id, message);
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
      src: this.#options.url(info.id, manifest.entry ?? "", info.revision),
      ...(surface ? { surface: surface.id, placement: surface.placement } : {}),
      ...(surface?.hidden ? { hidden: true } : {}),
    });
    this.#commands.mounted(info);
  }

  #unmount(id: string): void {
    if (!this.#mounted.delete(id)) return;
    this.#greeted.delete(id);
    for (const waiter of this.#waiting.get(id) ?? []) {
      waiter.reject(new CommandError("cancelled", `${id} stopped`));
    }
    this.#waiting.delete(id);
    this.#commands.unmounted(id);
    this.#owners.drop(id);
    for (const [call, pending] of this.#pending) {
      if (pending.plugin !== id) continue;
      this.#pending.delete(call);
      pending.reject(new CommandError("cancelled", `${id} stopped before it answered`));
    }
    this.#deps.close(id);
  }

  #onEvent(event: BridgeEvent): void {
    const key = eventKey(event);
    if (key !== undefined) {
      // Owned events go only to the plugin whose call started them; other plugins never see them.
      const owner = this.#owners.route(event, key);
      if (owner !== undefined && this.#mounted.has(owner))
        this.#post(owner, { type: "desk:event", event });
      return;
    }
    if (event.event === "connector.changed" || event.event === "view.changed") {
      const manage = event.event === "connector.changed" ? "connector:manage" : "view:manage";
      this.#broadcast(event, manage);
      return;
    }
    if (event.event === "cmd.invoked" || event.event === "cmd.answered") {
      // The provider hears its invocations; a caller hears its answers. The desk's own go nowhere.
      const plugin = this.#commands.route(event);
      if (plugin && this.#mounted.has(plugin)) this.#post(plugin, { type: "desk:event", event });
      return;
    }
    if (event.event !== "plugin.changed") {
      // An event the core addressed (a prompt to the perm:manage holder, a subscribed event) goes
      // to the plugins it names; one that names nobody goes to whoever manages what it is about.
      const to = recipientsOf(event);
      if (to) {
        for (const id of to)
          if (this.#mounted.has(id)) this.#post(id, { type: "desk:event", event });
      } else if (event.event === "perm.prompt" || event.event === "perm.changed") {
        this.#broadcast(event, "perm:manage");
      }
      return;
    }
    this.#broadcast(event);
    if (this.#deps.listed) void this.#list().then((all) => this.#deps.listed?.(all));
    const { plugin, change, revision } = event.data;
    const info = this.#mounted.get(plugin);
    switch (change) {
      case "updated":
        if (info?.manifest?.entry) {
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

  /**
   * An event for the plugins whose manifest asks for `manage`: plugin.changed to the ones that manage
   * plugins (the sidebar), connector.changed and view.changed to the ones that manage those.
   */
  #broadcast(event: BridgeEvent, manage: Permission["permission"] = "plugin:manage"): void {
    for (const [id, info] of this.#mounted) {
      const manages = info.manifest?.permissions?.some((p) => p.permission === manage);
      if (manages) this.#post(id, { type: "desk:event", event });
    }
  }

  /**
   * A call's answer names the turn, watch, subscription or process it started: its events go to the
   * plugin that made the call, those that came early first. An unsubscribe ends its key.
   */
  #claim(request: BridgeRequest, response: BridgeResponse, owner: string): void {
    this.#commands.observe(request, response, owner);
    if (request.method === "data.unsubscribe" && response.ok) {
      this.#owners.release(`sub:${request.params.subscriptionId}`);
      return;
    }
    for (const event of this.#owners.claim(request, response, owner)) {
      this.#post(owner, { type: "desk:event", event });
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
        for (const shared of this.#shared.values()) this.#post(id, shared);
        this.#greeted.add(id);
        for (const waiter of this.#waiting.get(id) ?? []) waiter.resolve();
        this.#waiting.delete(id);
        break;
      case "desk:state":
        this.#state.set(id, message.state);
        break;
      case "desk:close":
        // The plugin is done with its surface for this session (the first run, for example).
        this.#unmount(id);
        break;
      case "desk:visible":
        this.#deps.show?.(id, message.visible === true);
        break;
      case "desk:key":
        this.#deps.key?.(id, message.key);
        break;
      case "desk:reply": {
        const pending = this.#pending.get(message.call);
        if (!pending || pending.plugin !== id) break;
        this.#pending.delete(message.call);
        if (message.ok) pending.resolve(message.result);
        else {
          const code = message.error?.code;
          const known = code === "cancelled" || code === "unknown_command" ? code : "failed";
          pending.reject(new CommandError(known, message.error?.message ?? "failed"));
        }
        break;
      }
      case "desk:calls":
        void Promise.all(
          message.calls.map(async (request) => ({
            request,
            response: await this.#deps.bridge.forward(request, id),
          })),
        ).then((answers) => {
          const results = answers.map(({ request, response }) => ({ id: request.id, response }));
          this.#post(id, { type: "desk:results", results });
          // After the results, so a plugin learns its turn, watch, subscription or process id first.
          for (const { request, response } of answers) this.#claim(request, response, id);
        });
        break;
    }
  };
}
