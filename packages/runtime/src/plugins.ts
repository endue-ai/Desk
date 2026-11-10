import type {
  BridgeEvent,
  BridgeRequest,
  BridgeResponse,
  Permission,
  PluginInfo,
} from "@endue-ai/bridge";
import { CommandError } from "./commands";
import { type Dnd, installDnd } from "./dnd/install";
import { Sleepers } from "./frames/sleepers";
import { eventKey, Owners } from "./owners";
import { PluginCommands } from "./plugin-commands";
import type { PluginHostDeps, PluginHostOptions } from "./plugin-host-deps";
import { type PluginMessage, recipientsOf } from "./plugin-messages";
import { surfaceUrl } from "./plugin-origins";
import { PluginAsks } from "./plugins-asks";
import { PluginGreetings } from "./plugins-greetings";
import { now, phase } from "./timing";

export type { PluginHostDeps, PluginHostOptions } from "./plugin-host-deps";

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
  /** Turns, watches, data subscriptions and processes, by the plugin whose call started them. */
  readonly #owners = new Owners();
  /** Commands delivered to plugins that wait for their reply. */
  readonly #asks = new PluginAsks();
  readonly #shared = new Map<string, unknown>();
  /** Plugins whose page said hello since their frame loaded, and callers waiting for one. */
  readonly #greetings = new PluginGreetings();
  /** When each plugin mounting now got its surface: its `mount <id>` phase ends at its hello. */
  readonly #mounting = new Map<string, number>();
  readonly #commands: PluginCommands;
  /** Plugins that were not ready when last listed: one of them turning ready on an update mounts. */
  #unready = new Set<string>();
  #offEvents: (() => void) | undefined;
  /** Plugins whose frame the runtime unloaded, until the next one says hello (ADR 0070). */
  readonly #sleepers = new Sleepers((id) => this.#deps.wake?.(id) === true);
  readonly #dnd: Dnd;

  constructor(deps: PluginHostDeps, options: PluginHostOptions) {
    this.#deps = deps;
    this.#options = options;
    this.#commands = new PluginCommands(deps.bridge);
    this.#dnd = installDnd(deps, () => this.mounted());
  }

  async start(): Promise<void> {
    this.#deps.win.addEventListener("message", this.#onMessage);
    this.#offEvents = this.#deps.bridge.onEvent((event) => this.#onEvent(event));
    const start = now();
    const all = await this.#list();
    this.#deps.listed?.(all);
    // Whatever goes wrong deciding it, every plugin mounts as before.
    const asleep = (await this.#deps.startAsleep?.(all).catch(() => undefined)) ?? new Set();
    for (const info of all) this.#mount(info, asleep.has(info.id));
    phase("plugin list", start);
  }

  /** Launch an installed UI plugin, including one put away or disabled by the person. */
  async launch(id: string, waitForReady = false): Promise<void> {
    let info = (await this.#list()).find((p) => p.id === id);
    if (info?.status !== "ready" || !this.#mounts(info.manifest))
      throw new Error(`No launchable plugin ${id}`);
    if (!info.enabled) {
      ({ plugin: info } = await this.#deps.bridge.call("plugin.setEnabled", {
        plugin: id,
        enabled: true,
        scope: MANAGE,
      }));
    }
    this.#mount(info);
    this.#sleepers.rise(id);
    this.#deps.show?.(id, true);
    if (waitForReady) await this.whenReady(id);
  }

  mounted(): string[] {
    return [...this.#mounted.keys()];
  }

  /** Whether a mounted plugin has no live frame until its next hello: it started asleep, or unloaded. */
  asleep(id: string): boolean {
    return this.#mounted.has(id) && this.#sleepers.asleep(id);
  }

  /** Open the surface of a plugin that started asleep (#590); nothing for any other. */
  wake(id: string): void {
    this.#sleepers.rise(id);
  }

  /** Send a mounted plugin a message by name (`ctx.commands.on(name, handler)` in the SDK). */
  command(id: string, name: string, args?: unknown): void {
    if (this.#mounted.has(id)) this.#post(id, { type: "desk:command", name, args });
  }

  /** Ask one plugin something and wait for its answer (desk.files.visit): the desk's, not commands. */
  request(id: string, name: string, args?: unknown): Promise<unknown> {
    if (!this.#mounted.has(id))
      return Promise.reject(new CommandError("unknown_command", `${id} is not running`));
    if (!this.greeted(id)) return this.whenReady(id).then(() => this.request(id, name, args));
    return this.#asks.ask(id, name, (call) =>
      this.#post(id, { type: "desk:command", name, args, call }),
    );
  }

  /** Resolves once a mounted plugin has connected (said hello); rejects if it stops first. */
  whenReady(id: string): Promise<void> {
    if (this.greeted(id)) return Promise.resolve();
    if (this.#sleepers.asleep(id)) this.#sleepers.rouse(id);
    return this.#greetings.next(id);
  }

  /** Take a plugin's surface away for the rest of this session, as `desk:close` does. */
  unmount(id: string): void {
    this.#unmount(id);
  }

  /** Whether a plugin's frame said hello since it last loaded, so it can answer the desk. */
  greeted(id: string): boolean {
    return this.#greetings.greeted(id, this.#deps.frame(id));
  }

  /** Whether the desk waits for an answer from a plugin, besides `except`. */
  busy(id: string, except?: string): boolean {
    return this.#asks.busy(id, except);
  }

  /**
   * The runtime took a plugin's frame away (ADR 0070): `state` goes to its next init as `restored`,
   * and what the gone frame was asked is cancelled. The plugin stays mounted.
   */
  unloaded(id: string, state: unknown): void {
    if (!this.#mounted.has(id)) return;
    this.#greetings.forget(id);
    this.#sleepers.sleep(id, state);
    this.#cancel(id, "was unloaded before it answered");
  }

  /** Keep a message for every plugin, like the theme: sent now, and after each plugin's init. */
  share(message: { type: string; [field: string]: unknown }): void {
    this.#shared.set(message.type, message);
    for (const id of this.#mounted.keys()) this.#post(id, message);
  }

  stop(): void {
    this.#deps.win.removeEventListener("message", this.#onMessage);
    this.#offEvents?.();
    this.#dnd.stop();
    for (const id of this.mounted()) this.#unmount(id);
  }

  async #list(): Promise<PluginInfo[]> {
    const { plugins } = await this.#deps.bridge.call("plugin.list", { scope: MANAGE });
    this.#unready = new Set(plugins.filter((p) => p.status !== "ready").map((p) => p.id));
    return plugins;
  }

  /** Mount and unmount as `mayMount` says now: the roles setting changed (ADR 0104). */
  async reconcile(): Promise<void> {
    for (const info of await this.#list())
      if (this.#deps.mayMount?.(info) === false) this.#unmount(info.id);
      else this.#mount(info);
  }

  /** Mount a plugin: its surface opens now, or on its first use when it starts `asleep` (#590). */
  #mount(info: PluginInfo, asleep = false): void {
    const manifest = info.manifest;
    if (info.status !== "ready" || !info.enabled || !this.#mounts(manifest)) return;
    if (this.#mounted.has(info.id)) return;
    if (this.#deps.mayMount?.(info) === false) return;
    const surface = manifest.surfaces?.[0];
    this.#mounted.set(info.id, info);
    const open = () => {
      this.#mounting.set(info.id, now());
      this.#deps.open({
        id: info.id,
        title: surface?.title ?? manifest.name ?? info.id,
        // The revision as it is when the surface opens: an update may come while it sleeps.
        src: surfaceUrl(this.#options, this.#mounted.get(info.id) ?? info),
        ...(surface ? { surface: surface.id, placement: surface.placement } : {}),
        ...(surface?.hidden ? { hidden: true } : {}),
      });
    };
    if (asleep) this.#sleepers.doze(info.id, open);
    else this.#sleepers.load(info.id, open);
    this.#commands.mounted(info);
  }

  /**
   * Whether plugins of this manifest's kind get a surface: UI plugins, and native plugins on a
   * desk whose compositor hosts their processes (#59, ADR 0154).
   */
  #mounts(manifest: PluginInfo["manifest"]): manifest is NonNullable<PluginInfo["manifest"]> {
    return (
      manifest?.kind === "ui" || (manifest?.kind === "native" && this.#options.native === true)
    );
  }

  #unmount(id: string): void {
    if (!this.#mounted.delete(id)) return;
    this.#greetings.stop(id, new CommandError("cancelled", `${id} stopped`));
    this.#mounting.delete(id);
    this.#commands.unmounted(id);
    this.#owners.drop(id);
    // One that never woke has no surface to close.
    const opened = !this.#sleepers.dozing(id);
    this.#sleepers.forget(id);
    this.#cancel(id, "stopped before it answered");
    if (opened) this.#deps.close(id);
  }

  #cancel(id: string, why: string): void {
    this.#dnd.gone(id);
    this.#asks.cancel(id, `${id} ${why}`);
  }

  /**
   * Load a plugin's new revision in its frame, in place. The reload pings the page on the frame
   * first, while it still counts as greeted, so what it sent (its last desk:state) is in before it
   * goes (#84). From then on what needs the plugin's answer waits for the new page's hello, as on a
   * first load, and what the page it leaves was asked and has not answered by then is cancelled
   * then (#142). One asleep or still loading waits for a hello already.
   */
  #reload(id: string, src: string): void {
    this.#deps.reload(id, src);
    if (this.#sleepers.waits(id)) return;
    this.#greetings.forget(id);
    this.#sleepers.reload(id);
    this.#asks.leaving(id);
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
      const plugin = this.#commands.route(event, this.#mounted);
      if (plugin) this.#post(plugin, { type: "desk:event", event });
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
        // A native plugin has no entry: its frame loads again, and the desk starts its new program.
        if (info?.manifest?.entry || info?.manifest?.native) {
          const next = { ...info, revision };
          this.#mounted.set(plugin, next);
          if (!this.#sleepers.dozing(plugin)) this.#reload(plugin, surfaceUrl(this.#options, next));
        } else if (!info && this.#unready.has(plugin)) {
          // A dev folder filled or fixed while the desk runs: the plugin turns ready on its update.
          // One the person or the plugin put away stays away; #mount takes only a ready, enabled UI plugin.
          void this.#list().then((all) => {
            const fresh = all.find((p) => p.id === plugin);
            if (fresh) this.#mount(fresh);
          });
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
          // Turned on while it sleeps since the start (desk.display.show does): its surface opens.
          this.#sleepers.rise(plugin);
        });
        break;
    }
  }

  /** An event for the plugins that manage what it is about (plugin, connector or view:manage). */
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
    if (!this.#sleepers.waits(id)) this.#deps.frame(id)?.postMessage(message, "*");
    else if (this.#sleepers.hold(id, message) === "stuck")
      this.#commands.refuse(message, id, `${id} is asleep and its frame cannot load`);
  }

  readonly #onMessage = (event: MessageEvent): void => {
    const id = this.mounted().find((candidate) => this.#deps.frame(candidate) === event.source);
    if (!id) return;
    const message = event.data as PluginMessage;
    if (this.#dnd.message(id, message)) return;
    switch (message?.type) {
      case "desk:hello": {
        const mounting = this.#mounting.get(id);
        if (mounting !== undefined) {
          this.#mounting.delete(id);
          phase(`mount ${id}`, mounting);
        }
        // A new page: what the one it replaced was asked and did not answer, it never will.
        this.#asks.cancel(id, `${id} reloaded before it answered`, "left");
        const { restored, waited } = this.#sleepers.woke(id);
        this.#post(id, {
          type: "desk:init",
          pluginId: id,
          state: this.#state.get(id),
          ...(restored === undefined ? {} : { restored }),
        });
        for (const shared of this.#shared.values()) this.#post(id, shared);
        for (const held of waited) this.#post(id, held);
        this.#greetings.hello(id, this.#deps.frame(id));
        break;
      }
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
      case "desk:ready":
      case "desk:failed":
        this.#deps.outcome?.(id, message.type === "desk:ready");
        break;
      case "desk:reply":
        this.#asks.reply(id, message);
        break;
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
