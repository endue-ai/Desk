/**
 * desk.plugins.open (ADR 0109): bring a plugin up and give it the focus. A UI plugin launches its
 * frame (plugins.ts). A data-only plugin, a view or a policy, has no frame: it opens what its own
 * `<id>.open` command shows (desk.today's day, desk.fleet's board). That command is an alias
 * (policies/aliases.ts), run here by its target, since a plugin just turned on has no alias yet. A
 * plugin with neither has nothing to show, and the answer says so. With `another: true` an app
 * whose first surface says `instances: "many"` opens in a further window, a page of its own (ADR
 * 0212's windows, ADR 0226), and the answer names it; its first window opens as always.
 */
import type { BridgeClient, CommandCall, PluginInfo } from "@endue-ai/bridge";
import { OPEN_PLUGIN } from "./agent-specs";
import { CommandError, type Commands } from "./commands";

const MANAGE = { permission: "plugin:manage" } as const;

/** What opens a data-only plugin: its own `<id>.open` command's target. */
export function openerOf(info: PluginInfo): CommandCall | undefined {
  return info.manifest?.contributes?.commands?.find((c) => c.id === `${info.id}.open`)?.runs;
}

export interface OpenPluginDeps {
  commands: Commands;
  bridge: BridgeClient;
  /** Launch a UI plugin (PluginHost.launch); it says when there is no such plugin. */
  launch(id: string, waitForReady: boolean): Promise<void>;
  focus(id: string): void;
  /** Another window of a running plugin (PluginHost.another): its key; undefined: none runs. */
  another?(id: string, waitForReady: boolean): Promise<string | undefined>;
}

/** `OpenPluginDeps.another` over a plugin host: a running plugin's next window, once asked for. */
export function anotherWindow(host: {
  instances(plugin: string): string[];
  another(plugin: string): string;
  whenReady(key: string): Promise<void>;
}): NonNullable<OpenPluginDeps["another"]> {
  return async (id, waitForReady) => {
    if (host.instances(id).length === 0) return undefined;
    const key = host.another(id);
    if (waitForReady) await host.whenReady(key);
    return key;
  };
}

export function defineOpenPlugin(deps: OpenPluginDeps): () => void {
  const { commands, bridge, launch, focus } = deps;
  return commands.define("desk.plugins.open", {
    title: "Open a plugin",
    owner: "desk",
    keywords: ["launch", "application"],
    run: async (args) => {
      const {
        plugin: id,
        waitForReady,
        another,
      } = (args ?? {}) as {
        plugin?: unknown;
        waitForReady?: unknown;
        another?: unknown;
      };
      if (typeof id !== "string") throw new Error("Choose a plugin to open");
      const { plugins } = await bridge.call("plugin.list", { scope: MANAGE });
      const info = plugins.find((p) => p.id === id);
      if (another === true) {
        if (info?.manifest?.surfaces?.[0]?.instances !== "many")
          throw new CommandError(
            "failed",
            `${id} opens in one window: its manifest's first surface does not say instances: "many"`,
          );
        const window = await deps.another?.(id, waitForReady === true);
        if (window !== undefined) {
          focus(window);
          return { window };
        }
      }
      if (info?.status !== "ready" || !info.manifest || info.manifest.kind === "ui") {
        await launch(id, waitForReady === true);
        focus(id);
        return;
      }
      const opens = openerOf(info);
      if (!opens) throw new Error(`${id} has no window to open`);
      if (!info.enabled)
        await bridge.call("plugin.setEnabled", { plugin: id, enabled: true, scope: MANAGE });
      await commands.run(opens.command, opens.args ?? {});
    },
    // Eris brings a plugin up before working in it, or when the person asks (ADR 0109).
    agent: OPEN_PLUGIN,
  });
}
