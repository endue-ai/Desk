/**
 * Plugins' commands in the core's registry (ADR 0017): the host registers what a plugin's manifest
 * declares when it mounts and unregisters it when it goes, notes what plugins register themselves,
 * and routes cmd.invoked to the provider and cmd.answered to the caller.
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
  /** Command id -> the plugin that provides it. */
  readonly #provides = new Map<string, string>();

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
  }

  /** Register the commands a mounting plugin's manifest declares under its own id. */
  mounted(info: PluginInfo): void {
    const own = (info.manifest?.contributes?.commands ?? []).filter((c) =>
      c.id.startsWith(`${info.id}.`),
    );
    for (const command of own) {
      const params = {
        id: command.id,
        title: command.title,
        ...(command.keywords ? { keywords: command.keywords } : {}),
      };
      void this.#bridge
        .call("cmd.register", params, { caller: info.id })
        .then(() => this.#provides.set(command.id, info.id))
        .catch(() => {});
    }
  }

  /** A plugin went: its commands go too. */
  unmounted(plugin: string): void {
    for (const [id, provider] of [...this.#provides]) {
      if (provider !== plugin) continue;
      this.#provides.delete(id);
      void this.#bridge.call("cmd.unregister", { id }, { caller: plugin }).catch(() => {});
    }
  }

  /** Note what a plugin registered or unregistered itself. */
  observe(request: BridgeRequest, response: BridgeResponse, plugin: string): void {
    if (!response.ok) return;
    if (request.method === "cmd.register") this.#provides.set(request.params.id, plugin);
    if (request.method === "cmd.unregister") this.#provides.delete(request.params.id);
  }

  /** The plugin a cmd.* event is for, or undefined when it is not a cmd event for a plugin. */
  route(event: BridgeEvent): string | undefined {
    if (event.event === "cmd.invoked") return this.#provides.get(event.data.id);
    if (event.event === "cmd.answered") return event.data.caller;
    return undefined;
  }
}
