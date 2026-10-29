/**
 * The policy hub: the commands, the settings and the policies in force, kept current from
 * plugin.list and init.get. Each policy module (keys, display, theme, ...) listens here.
 */
import type { BridgeClient, PluginInfo } from "@endue-ai/bridge";
import { Commands } from "./commands";
import { collect, emptyPolicy, type PolicySet } from "./policy";
import { Settings } from "./settings";

export class PolicyHub {
  readonly commands: Commands;
  readonly settings = new Settings();
  #policy: PolicySet = emptyPolicy();
  #plugins: PluginInfo[] = [];
  #profile = "default";
  readonly #listeners = new Set<(policy: PolicySet) => void>();

  constructor(bridge: BridgeClient) {
    this.commands = new Commands(bridge);
  }

  get policy(): PolicySet {
    return this.#policy;
  }

  get plugins(): readonly PluginInfo[] {
    return this.#plugins;
  }

  /** The profile init.yaml asks to start in. */
  get startProfile(): string {
    return this.#profile;
  }

  /** Collect the policies of the plugins as listed now, and tell every module. */
  apply(plugins: readonly PluginInfo[]): void {
    this.#plugins = [...plugins];
    this.#policy = collect(plugins);
    // Plugins register their own commands (the plugin host does it for what a manifest declares).
    this.commands.setActive(this.#policy.plugins);
    const defaults = Object.fromEntries(
      Object.entries(this.#policy.settings).map(([key, { owner: _owner, ...setting }]) => [
        key,
        setting,
      ]),
    );
    this.settings.setDefaults(defaults);
    for (const listener of this.#listeners) listener(this.#policy);
  }

  /** Read init.yaml's settings and start profile. A core that cannot answer leaves the defaults. */
  async readInit(bridge: BridgeClient): Promise<void> {
    try {
      const init = await bridge.call("init.get", {});
      this.#profile = init.profile;
      this.settings.setLayer("init", init.settings);
    } catch {
      // No init.get (an older core, or the browser stub): the defaults stay in force.
    }
  }

  /** Hear every new set of policies; the listener also runs once now. */
  onPolicy(listener: (policy: PolicySet) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#policy);
    return () => this.#listeners.delete(listener);
  }

  /** Whether a plugin is on now, as the last plugin.list said. */
  enabled(id: string): boolean {
    return this.#policy.plugins.includes(id);
  }
}
