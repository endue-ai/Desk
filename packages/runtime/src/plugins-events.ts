/**
 * Which plugin windows hear a core event (`PluginHost`). Owned events (a turn, a watch, a
 * subscription, a process) go to the window whose call started them; a command invocation to the
 * provider's window in use and a command's answer to the window that ran it; an event the core
 * addressed to plugins to every window of each; connector, view, permission and plugin changes to
 * every window of the plugins that manage them. A plugin with one window has one key, its id
 * (ADR 0212).
 */
import type {
  BridgeEvent,
  BridgeRequest,
  BridgeResponse,
  Permission,
  PluginChangedData,
  PluginInfo,
} from "@endue-ai/bridge";
import { type PluginInstances, pluginOf } from "./instances";
import { eventKey, type Owners } from "./owners";
import type { PluginCommands } from "./plugin-commands";
import { recipientsOf } from "./plugin-messages";

export interface EventRoutes {
  owners: Owners;
  commands: PluginCommands;
  instances: PluginInstances;
  mounted: ReadonlyMap<string, PluginInfo>;
  /** Post a message to one window. */
  post(key: string, message: unknown): void;
}

/** Route a core event to the windows it is for. False for plugin.changed, which the host acts on. */
export function routeEvent(event: BridgeEvent, routes: EventRoutes): boolean {
  const { owners, commands, instances, mounted } = routes;
  const deliver = (key: string | undefined) => {
    if (key !== undefined) routes.post(key, { type: "desk:event", event });
  };
  const key = eventKey(event);
  if (key !== undefined) {
    // Owned events go only to the window whose call started them; other plugins never see them.
    const owner = owners.route(event, key);
    if (owner !== undefined && instances.has(owner)) deliver(owner);
    return true;
  }
  if (event.event === "connector.changed" || event.event === "view.changed") {
    broadcast(
      event,
      routes,
      event.event === "connector.changed" ? "connector:manage" : "view:manage",
    );
    return true;
  }
  if (event.event === "cmd.invoked" || event.event === "cmd.answered") {
    // The provider hears its invocations; a caller hears its answers. The desk's own go nowhere.
    const plugin = commands.route(event, mounted);
    if (plugin === undefined) return true;
    deliver(
      event.event === "cmd.answered"
        ? instances.answered(event.data.invocationId, plugin)
        : instances.inUse(plugin),
    );
    return true;
  }
  if (event.event === "plugin.changed") return false;
  // An event the core addressed (a prompt to the perm:manage holder, a subscribed event) goes to
  // the plugins it names; one that names nobody goes to whoever manages what it is about.
  const to = recipientsOf(event);
  if (to) {
    for (const id of to) for (const window of instances.of(id)) deliver(window);
  } else if (event.event === "perm.prompt" || event.event === "perm.changed") {
    broadcast(event, routes, "perm:manage");
  }
  return true;
}

/** An event for every window of the plugins that manage what it is about (plugin:manage by default). */
export function broadcast(
  event: BridgeEvent,
  routes: EventRoutes,
  manage: Permission["permission"] = "plugin:manage",
): void {
  for (const [id, info] of routes.mounted) {
    const manages = info.manifest?.permissions?.some((p) => p.permission === manage);
    if (!manages) continue;
    for (const key of routes.instances.of(id)) routes.post(key, { type: "desk:event", event });
  }
}

/**
 * A call's answer names the turn, watch, subscription, process or command run it started: its
 * events go to the window that made the call, those that came early first. An unsubscribe ends
 * its key.
 */
export function claim(
  request: BridgeRequest,
  response: BridgeResponse,
  owner: string,
  routes: EventRoutes,
): void {
  routes.commands.observe(request, response, pluginOf(owner));
  if (request.method === "cmd.invoke" && response.ok)
    routes.instances.ran((response.result as { invocationId: string }).invocationId, owner);
  if (request.method === "data.unsubscribe" && response.ok) {
    routes.owners.release(`sub:${request.params.subscriptionId}`);
    return;
  }
  for (const event of routes.owners.claim(request, response, owner)) {
    routes.post(owner, { type: "desk:event", event });
  }
}

/** What a plugin's change (plugin.changed) asks of the host. */
export interface ChangeHost {
  /** The mounted plugins; an update keeps the new revision here. */
  mounted: Map<string, PluginInfo>;
  /** Whether a plugin was not ready when last listed. */
  unready(plugin: string): boolean;
  windows(plugin: string): string[];
  list(): Promise<PluginInfo[]>;
  mount(info: PluginInfo): void;
  unmount(plugin: string): void;
  dropOwners(key: string): void;
  /** Load window `key`'s page at `info`'s revision, in place. */
  reload(key: string, info: PluginInfo): void;
  /** Open the surface of a plugin that started asleep. */
  rise(plugin: string): void;
}

/** A plugin was updated, turned on or off, installed or removed: its windows follow. */
export function pluginChanged(data: PluginChangedData, host: ChangeHost): void {
  const { plugin, change, revision } = data;
  const info = host.mounted.get(plugin);
  const fresh = (then: (info: PluginInfo | undefined) => void) =>
    void host.list().then((all) => then(all.find((p) => p.id === plugin)));
  switch (change) {
    case "updated":
      // A native plugin has no entry: its frame loads again, and the desk starts its new program.
      if (info?.manifest?.entry || info?.manifest?.native) {
        const next = { ...info, revision };
        host.mounted.set(plugin, next);
        for (const key of host.windows(plugin)) host.reload(key, next);
      } else if (!info && host.unready(plugin)) {
        // A dev folder filled or fixed while the desk runs: the plugin turns ready on its update.
        // One the person or the plugin put away stays away; mount takes only a ready, enabled UI plugin.
        fresh((found) => found && host.mount(found));
      }
      break;
    case "disabled":
    case "removed":
      for (const key of host.windows(plugin)) host.dropOwners(key);
      host.unmount(plugin);
      break;
    case "enabled":
    case "installed":
      fresh((found) => {
        if (found) host.mount({ ...found, enabled: true });
        // Turned on while it sleeps since the start (desk.display.show does): its surface opens.
        host.rise(plugin);
      });
      break;
  }
}
