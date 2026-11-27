/** Agent tools for plugin inventory, market reviews, and narrowing existing permissions. */
import type { BridgeClient, MarketKind, PluginInfo } from "@endue-ai/bridge";
import { CommandError, type Commands } from "../commands";
import { MANAGE_PLUGINS } from "../plugins-launch";
import { type DeskContext, disposer, type Installed } from "./context";

const PERMISSIONS = { permission: "perm:manage" } as const;
const NAME = { type: "string", minLength: 1 };
const QUERY = { type: "string", maxLength: 500 };
const KINDS = ["view", "pack", "plugin", "theme", "design-system"] satisfies MarketKind[];
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
});
const text = (value: string | undefined) => value?.trim().toLowerCase() ?? "";

interface PluginTools {
  opened(plugin: string): boolean;
  confirmClose(plugin: string): Promise<boolean>;
}

export function installPluginTools(
  { hub, bridge }: Pick<DeskContext, "hub" | "bridge">,
  { opened, confirmClose }: PluginTools,
): Installed {
  const offs = disposer();
  const { commands } = hub;
  const plugins = async () => (await bridge.call("plugin.list", { scope: MANAGE_PLUGINS })).plugins;
  const grants = async (caller?: string) => {
    const known = new Set((await plugins()).map((plugin) => plugin.id));
    const eligible = (id: string) => id.startsWith("agent:") || known.has(id);
    if (caller !== undefined && !eligible(caller)) return [];
    const result = await bridge.call("perm.list", {
      scope: PERMISSIONS,
      ...(caller === undefined ? {} : { caller }),
    });
    return result.grants.filter((held) => eligible(held.caller));
  };

  offs.add(
    commands.define("desk.plugins.list", {
      title: "List installed plugins",
      owner: "desk",
      agent: {
        description:
          "List the installed plugins by name or ID and see whether they are enabled, autoloaded and open.",
        args: schema({ state: { enum: ["on", "off", "open", "failed"] }, query: QUERY }),
        readOnly: true,
      },
      run: async (args) => {
        const { state, query } = args as { state?: string; query?: string };
        const needle = text(query);
        const shown = (await plugins()).filter(
          (plugin) =>
            stateMatches(plugin, opened(plugin.id), state) &&
            [plugin.id, plugin.manifest?.name].some((name) => text(name).includes(needle)),
        );
        return {
          plugins: shown.map(({ id, enabled, manifest }) => ({
            id,
            name: manifest?.name ?? id,
            kind: manifest?.kind ?? null,
            enabled,
            autoload: manifest?.autoload === true,
            open: opened(id),
          })),
        };
      },
    }),
  );

  offs.add(
    commands.define("desk.plugins.turn-off", {
      title: "Turn off an installed plugin",
      owner: "desk",
      agent: {
        description: "Turn off an installed plugin by its exact ID from desk.plugins.list.",
        args: schema({ plugin: NAME }, ["plugin"]),
      },
      run: async (args, { caller }) => {
        const { plugin: id } = args as { plugin: string };
        const before = (await plugins()).find((plugin) => plugin.id === id);
        if (!before) throw new CommandError("failed", `No installed plugin ${id}`);
        if (caller?.startsWith("agent:")) {
          if (before.manifest?.permissions?.some(({ permission }) => permission === "perm:manage"))
            throw new CommandError(
              "failed",
              "Manage the permissions responder in the Plugins window",
            );
          if (!(await confirmClose(id)))
            throw new CommandError("cancelled", "Turning off the plugin was cancelled");
        }
        const { plugin } = await bridge.call("plugin.setEnabled", {
          plugin: id,
          enabled: false,
          scope: MANAGE_PLUGINS,
        });
        return { id, enabled: plugin.enabled };
      },
    }),
  );

  // These two commands are owned by the desk. The Permissions provider's approval tools stay
  // protected by the core's rule for manifests declaring perm:manage.
  offs.add(
    commands.define("endue.permissions.grants", {
      title: "List plugin and agent grants",
      owner: "desk",
      agent: {
        description:
          "Read the grants installed plugins and agents hold. Optionally give an exact caller ID.",
        args: schema({ caller: NAME }),
        readOnly: true,
      },
      run: async (args) => ({ grants: await grants((args as { caller?: string }).caller) }),
    }),
  );
  offs.add(
    commands.define("endue.permissions.revoke", {
      title: "Revoke a plugin or agent grant",
      owner: "desk",
      agent: {
        description: "Revoke one grant by its ID from endue.permissions.grants.",
        args: schema({ grant: NAME }, ["grant"]),
      },
      run: async (args, { caller }) => {
        const { grant } = args as { grant: string };
        const held = (await grants()).find((entry) => entry.grant.grantId === grant);
        if (!held)
          throw new CommandError("failed", "Give a grant ID from endue.permissions.grants");
        if (caller?.startsWith("agent:") && held.grant.permission.permission === "perm:manage")
          throw new CommandError("failed", "Manage that grant in the Permissions window");
        await bridge.call("perm.revoke", { grantId: grant, scope: PERMISSIONS });
        return { grant, revoked: true };
      },
    }),
  );
  return { dispose: offs.dispose };
}

function stateMatches(plugin: PluginInfo, open: boolean, state?: string): boolean {
  switch (state) {
    case "on":
      return plugin.enabled;
    case "off":
      return !plugin.enabled;
    case "open":
      return open;
    case "failed":
      return plugin.status === "failed";
    default:
      return true;
  }
}

export interface MarketChoice {
  kind: MarketKind;
  id: string;
}

export function installMarketTools(
  bridge: BridgeClient,
  commands: Commands,
  review: (choice: MarketChoice) => unknown,
): () => void {
  const offs = disposer();
  const kind = { enum: KINDS };
  offs.add(
    commands.define("desk.market.search", {
      title: "Search the market",
      owner: "desk",
      agent: {
        description:
          "Search the current market by kind and text. Give an empty query to list that kind.",
        args: schema({ kind, query: QUERY }, ["kind", "query"]),
        readOnly: true,
      },
      run: async (args) => {
        const { kind: requested, query } = args as { kind: MarketKind; query: string };
        const needle = text(query);
        const { entries } = await bridge.call("market.list", { scope: MANAGE_PLUGINS });
        return {
          entries: entries
            .filter(
              ({ entry }) =>
                entry.kind === requested &&
                [entry.id, entry.name, entry.description, entry.publisher].some((part) =>
                  text(part).includes(needle),
                ),
            )
            .slice(0, 50)
            .map(({ entry, state, verified }) => ({
              id: entry.id,
              name: entry.name,
              kind: entry.kind,
              version: entry.version,
              publisher: entry.publisher,
              description: entry.description,
              state,
              verified,
            })),
        };
      },
    }),
  );
  offs.add(
    commands.define("desk.market.install", {
      title: "Install from the market",
      owner: "desk",
      agent: {
        description:
          "Install an exact market ID and kind from desk.market.search after the person reviews its permissions.",
        args: schema({ kind, id: NAME }, ["kind", "id"]),
        irreversible: true,
      },
      run: (args) => review(args as MarketChoice),
    }),
  );
  return offs.dispose;
}
