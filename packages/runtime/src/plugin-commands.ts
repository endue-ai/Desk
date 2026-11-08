/**
 * Plugins' commands in the core's registry (ADR 0017): the host registers what a plugin's manifest
 * declares when it mounts and unregisters it when it goes, notes what plugins register themselves,
 * and routes cmd.invoked to the provider and cmd.answered to the caller. An invocation the provider
 * cannot hear is answered with an error instead (#1): its caller would wait forever.
 */
import type {
  BridgeClient,
  BridgeEvent,
  BridgeRequest,
  BridgeResponse,
  PluginInfo,
} from "@endue-ai/bridge";

export class PluginCommands {
  readonly #bridge: BridgeClient;
  /** Command id -> the plugin that provides it, until the core has heard that it went. */
  readonly #provides = new Map<string, string>();
  /** The plugins mounted now. */
  readonly #live = new Set<string>();

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
  }

  /**
   * Register the commands a mounting plugin's manifest declares under its own id, with what agents
   * read of them (ADR 0088): the description, the args and result schemas, `agent` and `readOnly`.
   * A command with `runs` is an alias the desk answers (policies/aliases.ts), so it is not the
   * plugin's.
   */
  mounted(info: PluginInfo): void {
    this.#live.add(info.id);
    const own = (info.manifest?.contributes?.commands ?? []).filter(
      (c) => c.id.startsWith(`${info.id}.`) && !c.runs,
    );
    for (const command of own) {
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
      void this.#bridge
        .call("cmd.register", params, { caller: info.id })
        .then(() => this.#provided(command.id, info.id))
        .catch(() => {});
    }
  }

  /** A plugin went: its commands go too. */
  unmounted(plugin: string): void {
    this.#live.delete(plugin);
    for (const [id, provider] of [...this.#provides]) if (provider === plugin) this.#withdraw(id);
  }

  /** Note what a plugin registered or unregistered itself. */
  observe(request: BridgeRequest, response: BridgeResponse, plugin: string): void {
    if (!response.ok) return;
    if (request.method === "cmd.register") this.#provided(request.params.id, plugin);
    if (request.method === "cmd.unregister") this.#provides.delete(request.params.id);
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
    this.refuse({ event }, plugin, `${plugin} is not running`);
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
    if (!this.#live.has(plugin)) this.#withdraw(id);
  }

  /** Unregister a gone plugin's command; it routes to the plugin until the core has heard it. */
  #withdraw(id: string): void {
    const plugin = this.#provides.get(id);
    const done = () => {
      if (plugin && this.#provides.get(id) === plugin && !this.#live.has(plugin))
        this.#provides.delete(id);
    };
    void this.#bridge.call("cmd.unregister", { id }, { caller: plugin }).then(done, done);
  }
}
