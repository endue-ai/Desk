/**
 * Plugins' commands in the core's registry (ADR 0017): the host registers what a plugin's manifest
 * declares when it mounts and unregisters it when it goes, notes what plugins register themselves,
 * and routes cmd.invoked to the provider and cmd.answered to the caller. An invocation the provider
 * cannot hear is answered with an error instead (#1): its caller would wait forever.
 * A plugin whose last window closed is closed for the session, not gone (#565): what its manifest
 * declares stays registered, so the palette lists it and its keys work, and an invocation of one
 * opens the plugin again (`reopen`). What its page registered goes with the page.
 */
import type {
  BridgeClient,
  BridgeEvent,
  BridgeRequest,
  BridgeResponse,
  CommandContribution,
  PluginInfo,
} from "@endue-ai/bridge";

/** What opens a closed plugin for an invocation of one of its commands (PluginHost). */
export interface Reopen {
  launch(plugin: string, options: { automatic: boolean; background: boolean }): Promise<void>;
  /** Post a message to the plugin's window in use; it waits there for the page's hello. */
  post(plugin: string, message: unknown): void;
}

export class PluginCommands {
  readonly #bridge: BridgeClient;
  readonly #reopen: Reopen | undefined;
  /** Command id -> the plugin that provides it, until the core has heard that it went. */
  readonly #provides = new Map<string, string>();
  /** The plugins mounted now. */
  readonly #live = new Set<string>();
  /** Plugins closed for the session, with the commands their manifest declares (kept). */
  readonly #closed = new Map<string, Set<string>>();
  /** The commands each mounted plugin's manifest declares. */
  readonly #declared = new Map<string, Set<string>>();
  /** Eligible off plugins with manifest tools in the registry. */
  readonly #reserved = new Map<string, { revision: number; ids: Set<string> }>();
  readonly #reads = new Set<string>();

  constructor(bridge: BridgeClient, reopen?: Reopen) {
    this.#bridge = bridge;
    this.#reopen = reopen;
  }

  /**
   * Register the commands a mounting plugin's manifest declares under its own id, with what agents
   * read of them (ADR 0088): the description, the args and result schemas, `agent` and `readOnly`.
   * A command with `runs` is an alias the desk answers (policies/aliases.ts), so it is not the
   * plugin's.
   */
  mounted(info: PluginInfo): void {
    this.#live.add(info.id);
    this.#closed.delete(info.id);
    this.#reserved.delete(info.id);
    const own = this.#own(info);
    this.#declared.set(info.id, new Set(own.map((c) => c.id)));
    void this.#register(info.id, own);
  }

  /** Keep only the manifest's agent tools registered for a ready, dormant autoload plugin. */
  async prepare(eligible: PluginInfo[]): Promise<void> {
    const registering: Promise<void>[] = [];
    const byId = new Map(eligible.map((plugin) => [plugin.id, plugin]));
    for (const id of this.#reserved.keys()) {
      const info = byId.get(id);
      if (!info || (!info.enabled && !info.autoStart)) this.unmounted(id);
    }
    for (const info of eligible) {
      if (
        info.enabled ||
        !info.autoStart ||
        this.#reserved.get(info.id)?.revision === info.revision
      )
        continue;
      const own = this.#own(info).filter((command) => command.agent);
      const ids = new Set(own.map((command) => command.id));
      this.#reserved.set(info.id, { revision: info.revision, ids });
      for (const [id, provider] of this.#provides)
        if (provider === info.id && !ids.has(id)) this.#withdraw(id);
      registering.push(this.#register(info.id, own));
    }
    await Promise.all(registering);
  }

  /** Whether a command requested by an agent can wake the provider without showing its window. */
  background(event: BridgeEvent | undefined): boolean {
    return (
      event?.event === "cmd.invoked" &&
      event.data.caller.startsWith("agent:") &&
      this.#reads.has(event.data.id)
    );
  }

  #own(info: PluginInfo) {
    return (info.manifest?.contributes?.commands ?? []).filter(
      (c) => c.id.startsWith(`${info.id}.`) && !c.runs,
    );
  }

  async #register(provider: string, commands: CommandContribution[]): Promise<void> {
    await Promise.all(
      commands.map((command) => {
        const params = {
          id: command.id,
          title: command.title,
          ...(command.keywords ? { keywords: command.keywords } : {}),
          ...(command.description ? { description: command.description } : {}),
          ...(command.args ? { argsSchema: command.args } : {}),
          ...(command.result ? { resultSchema: command.result } : {}),
          ...(command.agent ? { agent: true } : {}),
          ...(command.readOnly ? { readOnly: true } : {}),
        };
        return this.#bridge
          .call("cmd.register", params, { caller: provider })
          .then(() => {
            this.#markRead(command.id, command.readOnly === true);
            this.#provided(command.id, provider);
          })
          .catch(() => {});
      }),
    );
  }

  /** A plugin went (turned off, removed, taken away): its commands go too. */
  unmounted(plugin: string): void {
    this.#live.delete(plugin);
    this.#closed.delete(plugin);
    this.#reserved.delete(plugin);
    this.#declared.delete(plugin);
    for (const [id, provider] of [...this.#provides]) if (provider === plugin) this.#withdraw(id);
  }

  /** A plugin's last window closed: what its manifest declares stays, what its page added goes. */
  closed(plugin: string): void {
    if (!this.#live.delete(plugin)) return;
    this.#closed.set(plugin, this.#declared.get(plugin) ?? new Set());
    this.#declared.delete(plugin);
    for (const [id, provider] of [...this.#provides])
      if (provider === plugin && !this.#kept(id, plugin)) this.#withdraw(id);
  }

  /** Note what a plugin registered or unregistered itself. */
  observe(request: BridgeRequest, response: BridgeResponse, plugin: string): void {
    if (!response.ok) return;
    if (request.method === "cmd.register") {
      const { id, readOnly } = request.params;
      if (readOnly !== undefined) this.#markRead(id, readOnly);
      this.#provided(id, plugin);
    }
    if (request.method === "cmd.unregister") {
      this.#provides.delete(request.params.id);
      this.#reads.delete(request.params.id);
    }
  }

  /**
   * The mounted plugin a cmd.* event is for, or undefined when it is not a cmd event for one. An
   * invocation whose provider is not mounted is answered here.
   */
  route(event: BridgeEvent, mounted: { has(id: string): boolean }): string | undefined {
    let plugin: string | undefined;
    if (event.event === "cmd.invoked") plugin = this.#provides.get(event.data.id);
    if (event.event === "cmd.answered") plugin = event.data.caller;
    if (plugin === undefined || mounted.has(plugin)) return plugin;
    if (event.event === "cmd.invoked" && this.#reopen && this.#kept(event.data.id, plugin))
      this.#opens(plugin, event, this.#reopen);
    else this.refuse({ event }, plugin, `${plugin} is not running`);
    return undefined;
  }

  /** Answer the cmd.invoked a host message carries for `provider`, which cannot hear it. */
  refuse(message: unknown, provider: string, why: string): void {
    const { event } = message as { event?: BridgeEvent };
    if (event?.event !== "cmd.invoked") return;
    const error = { code: "failed" as const, message: why };
    const params = { invocationId: event.data.invocationId, error };
    void this.#bridge.call("cmd.answer", params, { caller: provider }).catch(() => {});
  }

  /** A registration came back: a plugin that went meanwhile takes it back at once. */
  #provided(id: string, plugin: string): void {
    this.#provides.set(id, plugin);
    if (!this.#live.has(plugin) && !this.#kept(id, plugin)) this.#withdraw(id);
  }

  /** A closed plugin's command ran: the plugin opens, and the invocation waits for its page. */
  #opens(plugin: string, event: BridgeEvent, reopen: Reopen): void {
    void reopen
      .launch(plugin, { automatic: this.#reserved.has(plugin), background: this.background(event) })
      .then(
        () => reopen.post(plugin, { type: "desk:event", event }),
        (error: unknown) => this.refuse({ event }, plugin, (error as Error).message),
      );
  }

  /** Whether `id` stays registered for `plugin`, closed for the session. */
  #kept(id: string, plugin: string): boolean {
    return (
      this.#closed.get(plugin)?.has(id) === true || this.#reserved.get(plugin)?.ids.has(id) === true
    );
  }

  #markRead(id: string, readOnly: boolean): void {
    if (readOnly) this.#reads.add(id);
    else this.#reads.delete(id);
  }

  /** Unregister a gone plugin's command; it routes to the plugin until the core has heard it. */
  #withdraw(id: string): void {
    const plugin = this.#provides.get(id);
    const done = () => {
      if (
        plugin &&
        this.#provides.get(id) === plugin &&
        !this.#live.has(plugin) &&
        !this.#kept(id, plugin)
      ) {
        this.#provides.delete(id);
        this.#reads.delete(id);
      }
    };
    void this.#bridge.call("cmd.unregister", { id }, { caller: plugin }).then(done, done);
  }
}
