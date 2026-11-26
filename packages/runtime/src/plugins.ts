import type { BridgeEvent, PluginInfo } from "@endue-ai/bridge";
import { CommandError } from "./commands";
import { type Dnd, installDnd } from "./dnd/install";
import { Sleepers } from "./frames/sleepers";
import { instanceNumber, PluginInstances, pluginOf } from "./instances";
import { Owners } from "./owners";
import { PluginCommands } from "./plugin-commands";
import type { PluginHostDeps, PluginHostOptions } from "./plugin-host-deps";
import type { PluginMessage } from "./plugin-messages";
import { surfaceUrl } from "./plugin-origins";
import { readTitleMessages } from "./plugin-title-messages";
import { PluginAsks } from "./plugins-asks";
import { closeSessions } from "./plugins-db";
import {
  broadcast,
  type ChangeHost,
  type EventRoutes,
  forwardCalls,
  pluginChanged,
  routeEvent,
} from "./plugins-events";
import { PluginGreetings } from "./plugins-greetings";
import { initMessage } from "./plugins-init";
import {
  enableForLaunch,
  hasSurface,
  type LaunchPluginOptions,
  MANAGE_PLUGINS,
} from "./plugins-launch";
import { WindowSearch } from "./plugins-search";
import { now, phase } from "./timing";

export type { PluginHostDeps, PluginHostOptions } from "./plugin-host-deps";

/** Mounts plugin surfaces and routes calls as the plugin owning each window (ADR 0212). */
export class PluginHost {
  readonly #deps: PluginHostDeps;
  readonly #options: PluginHostOptions;
  readonly #mounted = new Map<string, PluginInfo>();
  readonly #instances = new PluginInstances();
  readonly #search = new WindowSearch(this.#instances, this.#mounted);
  readonly #state = new Map<string, unknown>();
  /** Turns, watches, subscriptions, processes, by window: kept while one is put away (#160). */
  readonly #owners = new Owners();
  readonly #asks = new PluginAsks();
  readonly #shared = new Map<string, unknown>();
  readonly #greetings = new PluginGreetings();
  /** When each plugin mounting now got its surface: its `mount <id>` phase ends at its hello. */
  readonly #mounting = new Map<string, number>();
  readonly #commands: PluginCommands;
  readonly #titleMessages: ReturnType<typeof readTitleMessages>;
  /** Which windows hear each core event, and what a plugin's change does (`plugins-events.ts`). */
  readonly #routes: EventRoutes;
  readonly #changes: ChangeHost;
  /** Plugins that were not ready when last listed: one of them turning ready on an update mounts. */
  #unready = new Set<string>();
  #offEvents: (() => void) | undefined;
  /** Plugins whose frame the runtime unloaded, until the next one says hello (ADR 0070). */
  readonly #sleepers = new Sleepers((id) => this.#deps.wake?.(id) === true);
  readonly #dnd: Dnd;
  readonly #background = new Set<string>();

  constructor(deps: PluginHostDeps, options: PluginHostOptions) {
    this.#deps = deps;
    this.#options = options;
    this.#titleMessages = readTitleMessages(options.url, deps.language ?? (() => "en"));
    this.#commands = new PluginCommands(deps.bridge, {
      launch: (id, options) => this.launch(id, options),
      post: (id, message) => this.#post(this.#instances.resolve(id) ?? id, message),
    });
    this.#routes = {
      owners: this.#owners,
      commands: this.#commands,
      instances: this.#instances,
      mounted: this.#mounted,
      post: (key, message) => this.#post(key, message),
      bridge: deps.bridge,
    };
    this.#changes = {
      mounted: this.#mounted,
      unready: (id) => this.#unready.has(id),
      windows: (id) => this.#instances.of(id),
      list: () => this.#list(),
      mount: (info) => this.#mount(info),
      unmount: (id) => this.#unmount(id),
      dropOwners: (key) => this.#owners.drop(key),
      reload: (key, info) => {
        const src = surfaceUrl(this.#options, info, instanceNumber(key));
        if (!this.#sleepers.dozing(key)) this.#reload(key, src);
      },
      rise: (id) => this.#sleepers.rise(id),
    };
    this.#dnd = installDnd(deps, () => this.#instances.keys(), this.#mounted);
  }

  async start(): Promise<void> {
    this.#deps.win.addEventListener("message", this.#onMessage);
    this.#offEvents = this.#deps.bridge.onEvent((event) => this.#onEvent(event));
    const start = now();
    const all = await this.#list();
    await this.#listed(all);
    // Whatever goes wrong deciding it, every plugin mounts as before.
    const asleep = (await this.#deps.startAsleep?.(all).catch(() => undefined)) ?? new Set();
    for (const info of all) this.#mount(info, asleep.has(info.id));
    phase("plugin list", start);
  }

  async launch(
    id: string,
    wait: boolean | LaunchPluginOptions = false,
    mayEnable?: () => Promise<void>,
  ): Promise<void> {
    const info = (await this.#list()).find((p) => p.id === id);
    if (!info || !this.#eligible(info)) throw new Error(`No launchable plugin ${id}`);
    const options = typeof wait === "boolean" ? { waitForReady: wait, mayEnable } : wait;
    const { background, waitForReady } = options;
    if (background && (!this.#mounted.has(id) || this.#sleepers.dozing(id)))
      this.#background.add(id);
    try {
      this.#mount(await enableForLaunch(this.#deps.bridge, info, options));
      // A plugin whose first window closed while others stayed shows the one in use.
      const key = this.#instances.resolve(id) ?? id;
      this.#sleepers.rise(key);
      if (!background) this.#deps.show?.(key, true);
      if (waitForReady) await this.whenReady(key);
    } finally {
      this.#background.delete(id);
    }
  }

  /** Open another window of a mounted plugin (ADR 0212): its key; its frame may still connect.
   * `before` hears the key before the window opens, to ask for the tab that takes it (ADR 0270). */
  another(id: string, before?: (key: string) => void): string {
    const info = this.#mounted.get(id);
    if (!info) throw new Error(`${id} is not running`);
    const key = this.#instances.mint(id);
    before?.(key);
    this.#open(info, key);
    return key;
  }

  mounted(): string[] {
    return [...this.#mounted.keys()];
  }

  /** The windows open now: a plugin's, the first it opened first, or every mounted plugin's. */
  instances(plugin?: string): string[] {
    return plugin === undefined ? this.#instances.keys() : this.#instances.of(plugin);
  }

  /** A plugin's window in use: the one that last had the focus (`focused`) or called the desk. */
  inUse(plugin: string): string | undefined {
    return this.#instances.inUse(plugin);
  }
  readonly focused = (key: string): void => this.#instances.touch(key);

  /** Whether a window has no live frame until its next hello: it started asleep, or unloaded. */
  asleep(id: string): boolean {
    return this.#instances.has(id) && this.#sleepers.asleep(id);
  }

  /** Open the surface of a plugin that started asleep (#590); nothing for any other. */
  wake(id: string): void {
    this.#sleepers.rise(id);
  }

  /** Send a window (a plugin's in use by its id) a message by name (`ctx.commands.on` in the SDK). */
  command(id: string, name: string, args?: unknown): void {
    const key = this.#instances.resolve(id);
    if (key !== undefined) this.#post(key, { type: "desk:command", name, args });
  }

  /** Ask a window (a plugin's in use by its id) and wait for its answer (desk.files.visit). */
  request(id: string, name: string, args?: unknown): Promise<unknown> {
    const key = this.#instances.resolve(id);
    if (key === undefined)
      return Promise.reject(new CommandError("unknown_command", `${id} is not running`));
    if (!this.greeted(key)) return this.whenReady(key).then(() => this.request(key, name, args));
    return this.#asks.ask(key, name, (call) =>
      this.#post(key, { type: "desk:command", name, args, call }),
    );
  }

  /** Resolves once a window has connected (said hello); rejects if it stops first. */
  whenReady(id: string): Promise<void> {
    const key = this.#instances.resolve(id) ?? id;
    if (this.greeted(key)) return Promise.resolve();
    if (this.#sleepers.asleep(key)) this.#sleepers.rouse(key);
    return this.#greetings.next(key);
  }

  /** Take a window away for the session, as `desk:close` does: its database sessions end (ADR 0339).
   * A plugin's last window, or its first, closes the plugin; its manifest's commands stay (#565). */
  unmount(id: string): void {
    const plugin = pluginOf(id);
    // A later window that is not open (a tab kept from an earlier session) takes nothing with it.
    if (plugin !== id && !this.#instances.has(id)) return;
    const others = this.#instances.of(plugin).filter((key) => key !== id);
    if (others.length > 0 && this.#instances.has(id)) this.#close(id);
    else this.#unmount(plugin, true);
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
    if (!this.#instances.has(id)) return;
    this.#greetings.forget(id);
    this.#sleepers.sleep(id, state);
    this.#cancel(id, "was unloaded before it answered");
  }

  /** Keep a message for every plugin, like the theme: sent now, and after each plugin's init. */
  share(message: { type: string; [field: string]: unknown }): void {
    this.#shared.set(message.type, message);
    for (const key of this.#instances.keys()) this.#post(key, message);
  }

  stop(): void {
    this.#deps.win.removeEventListener("message", this.#onMessage);
    this.#offEvents?.();
    this.#dnd.stop();
    for (const id of this.mounted()) this.#unmount(id);
  }

  async #list(): Promise<PluginInfo[]> {
    const { plugins } = await this.#deps.bridge.call("plugin.list", { scope: MANAGE_PLUGINS });
    this.#unready = new Set(plugins.filter((p) => p.status !== "ready").map((p) => p.id));
    return this.#titleMessages(plugins);
  }

  /** Mount and unmount as `mayMount` says now: the roles setting changed (ADR 0104). */
  async reconcile(): Promise<void> {
    const all = await this.#list();
    for (const info of all) {
      if (this.#eligible(info)) this.#mount(info);
      else this.#unmount(info.id);
    }
    await this.#commands.prepare(all.filter((info) => this.#eligible(info)));
  }

  #eligible(info: PluginInfo): boolean {
    return hasSurface(info, this.#options.native) && this.#deps.mayMount?.(info) !== false;
  }

  async #listed(all: PluginInfo[]): Promise<void> {
    this.#deps.listed?.(all);
    await this.#commands.prepare(all.filter((info) => this.#eligible(info)));
  }

  /** Mount a plugin: its surface opens now, or on its first use when it starts `asleep` (#590). */
  #mount(info: PluginInfo, asleep = false): void {
    if (!info.enabled || this.#mounted.has(info.id) || !this.#eligible(info)) return;
    this.#mounted.set(info.id, info);
    this.#open(info, info.id, asleep);
    this.#commands.mounted(info);
  }

  /** Open window `key` of a mounted plugin: its surface opens now, or on its first use (#590). */
  #open(info: PluginInfo, key: string, asleep = false): void {
    const manifest = info.manifest;
    const surface = manifest?.surfaces?.[0];
    this.#instances.add(key);
    const open = () => {
      this.#mounting.set(key, now());
      this.#deps.open({
        id: key,
        title: surface?.title ?? manifest?.name ?? info.id,
        // The revision as it is when the surface opens: an update may come while it sleeps.
        src: surfaceUrl(this.#options, this.#mounted.get(info.id) ?? info, instanceNumber(key)),
        ...(surface ? { surface: surface.id, placement: surface.placement } : {}),
        ...(this.#background.delete(key) || surface?.hidden ? { hidden: true } : {}),
        ...(surface?.window ? { window: surface.window } : {}),
      });
    };
    if (asleep) this.#sleepers.doze(key, open);
    else this.#sleepers.load(key, open);
  }

  #unmount(id: string, closed = false): void {
    this.#commands[closed ? "closed" : "unmounted"](id);
    if (!this.#mounted.delete(id)) return;
    for (const key of this.#instances.of(id)) this.#close(key);
  }

  /** Close one window: what it was asked is cancelled; a window after the first forgets its work. */
  #close(key: string): void {
    if (!this.#instances.delete(key)) return;
    this.#greetings.stop(key, new CommandError("cancelled", `${key} stopped`));
    this.#mounting.delete(key);
    // One that never woke has no surface to close.
    const opened = !this.#sleepers.dozing(key);
    this.#sleepers.forget(key);
    this.#cancel(key, "stopped before it answered");
    this.#search.closed(key, this.#deps.bridge);
    closeSessions(this.#owners, key, this.#deps.bridge);
    if (key !== pluginOf(key)) {
      this.#state.delete(key);
      this.#owners.drop(key);
    }
    if (opened) this.#deps.close(key);
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
    if (routeEvent(event, this.#routes) || event.event !== "plugin.changed") return;
    broadcast(event, this.#routes);
    void this.#list().then((all) => this.#listed(all));
    pluginChanged(event.data, this.#changes);
  }

  #post(id: string, message: unknown): void {
    if (!this.#sleepers.waits(id)) {
      this.#deps.frame(id)?.postMessage(message, "*");
      return;
    }
    if (
      this.#sleepers.dozing(id) &&
      this.#commands.background((message as { event?: BridgeEvent }).event)
    )
      this.#background.add(id);
    if (this.#sleepers.hold(id, message) === "stuck")
      this.#commands.refuse(message, pluginOf(id), `${id} is asleep and its frame cannot load`);
  }

  readonly #onMessage = (event: MessageEvent): void => {
    const id = this.#instances.keys().find((key) => this.#deps.frame(key) === event.source);
    if (!id) return;
    const message = event.data as PluginMessage;
    if (this.#dnd.message(id, message)) return;
    switch (message?.type) {
      case "desk:hello": {
        const mounting = this.#mounting.get(id);
        if (this.#mounting.delete(id) && mounting !== undefined) phase(`mount ${id}`, mounting);
        // A new page: what the one it replaced was asked and did not answer, it never will.
        this.#asks.cancel(id, `${id} reloaded before it answered`, "left");
        const { restored, waited } = this.#sleepers.woke(id);
        this.#post(id, initMessage(id, this.#state.get(id), restored, this.#shared, this.#mounted));
        for (const shared of this.#shared.values()) this.#post(id, shared);
        for (const held of waited) this.#post(id, held);
        this.#greetings.hello(id, this.#deps.frame(id));
        break;
      }
      case "desk:state":
        this.#state.set(id, message.state);
        break;
      case "desk:close":
        // The plugin is done with this window for the session (the first run, for example).
        this.unmount(id);
        break;
      case "desk:visible":
        this.#deps.show?.(id, message.visible === true);
        break;
      case "desk:key":
        this.#deps.key?.(id, message.key);
        break;
      case "desk:ready":
      case "desk:failed":
        // A window that fails to start counts against its plugin (ADR 0061).
        this.#deps.outcome?.(pluginOf(id), message.type === "desk:ready");
        break;
      case "desk:reply":
        this.#asks.reply(id, message);
        break;
      case "desk:calls":
        void forwardCalls(id, message.calls, this.#routes, this.#search);
        break;
    }
  };
}
