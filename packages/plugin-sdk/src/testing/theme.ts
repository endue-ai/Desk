import type { PluginManifest } from "@endue-ai/bridge";
import builtInTheme from "../../../../plugins/theme/plugin.json";
import type { Scheme } from "../../../ui/src/theme/index";

export type { PluginManifest, ThemePackage } from "@endue-ai/bridge";
export { compileTheme, gate } from "../../../ui/src/theme/index";

/** The current built-in palette over which endue applies a theme's overrides. */
export function enduePalette(scheme: Scheme): Record<string, string> {
  const manifest: PluginManifest = builtInTheme as PluginManifest;
  const tokens = manifest.contributes?.themes?.find(
    (theme) => theme.id === `desk.theme.${scheme}`,
  )?.tokens;
  if (!tokens) throw new Error(`the endue palette for ${scheme} is missing`);
  return { ...tokens };
}
