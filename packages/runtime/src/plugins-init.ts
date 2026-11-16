// desk:init, the desk's first message to a plugin's page once it says hello (the SDK's HostMessage).
import type { PluginInfo } from "@endue-ai/bridge";
import { pluginOf } from "./instances";

/**
 * Window `id`'s init: its plugin, which window it is, its state and what it kept (ADR 0070), and
 * its words (ADR 0250): the desk's language as last shared, and the manifest's catalogs folder.
 */
export function initMessage(
  id: string,
  state: unknown,
  restored: unknown,
  shared: ReadonlyMap<string, unknown>,
  mounted: ReadonlyMap<string, PluginInfo>,
): Record<string, unknown> {
  const language = (shared.get("desk:language") as { language?: unknown } | undefined)?.language;
  const messages = mounted.get(pluginOf(id))?.manifest?.messages;
  return {
    type: "desk:init",
    pluginId: pluginOf(id),
    ...(id === pluginOf(id) ? {} : { instance: id }),
    state,
    ...(restored === undefined ? {} : { restored }),
    ...(typeof language === "string" ? { language } : {}),
    ...(messages ? { messages } : {}),
  };
}
