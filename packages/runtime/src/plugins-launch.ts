import type { BridgeClient, PluginInfo } from "@endue-ai/bridge";

export const MANAGE_PLUGINS = { permission: "plugin:manage" } as const;

export interface LaunchPluginOptions {
  waitForReady?: boolean;
  mayEnable?: () => Promise<void>;
  automatic?: boolean;
  background?: boolean;
}

export function hasSurface(info: PluginInfo, native: boolean | undefined): boolean {
  const kind = info.manifest?.kind;
  return info.status === "ready" && (kind === "ui" || (kind === "native" && native === true));
}

export async function enableForLaunch(
  bridge: BridgeClient,
  info: PluginInfo,
  { automatic, mayEnable }: LaunchPluginOptions,
): Promise<PluginInfo> {
  if (info.enabled) return info;
  if (automatic && !info.autoStart) throw new Error(`${info.id} is turned off`);
  await mayEnable?.();
  const { plugin } = await bridge.call("plugin.setEnabled", {
    plugin: info.id,
    enabled: true,
    ...(automatic ? { automatic } : {}),
    scope: MANAGE_PLUGINS,
  });
  return plugin;
}
