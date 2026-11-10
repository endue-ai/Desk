/**
 * theme.* on the browser core (the fixtures and the dev page): user themes and design systems kept in
 * memory beside plugin.list, as the native core keeps them in <data>/themes (#302, ADR 0091). Saves and
 * imports install a theme or design-system plugin and announce it; exports return a .desk-theme bundle
 * (.desk-design for a design system); removes take user ones only. theme.tokens answers the look's
 * revision, as the native core does for the compositor (ADR 0146).
 */
import type {
  BridgeEvent,
  PluginInfo,
  PluginManifest,
  StubHandlers,
  ThemeBundle,
} from "@endue-ai/bridge";

const user = (id: string) => id.startsWith("local.") || id.startsWith("market.");
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "theme";

export function themeHandlers(
  plugins: PluginInfo[],
  emit: (event: BridgeEvent) => void,
): StubHandlers {
  const files = new Map<string, Record<string, string>>();
  let revision = 0;
  let lastTable = "";
  const install = (manifest: PluginManifest, assets: Record<string, string>) => {
    const look =
      (manifest.kind === "theme" && manifest.theme) ||
      (manifest.kind === "design-system" && manifest.designSystem);
    if (!look) throw new Error("not a theme or design-system plugin");
    const at = plugins.findIndex((p) => p.id === manifest.id);
    const before = plugins[at];
    if (before && !user(before.id)) throw new Error(`${manifest.id} is not a user theme`);
    const info: PluginInfo = {
      id: manifest.id,
      status: "ready",
      enabled: true,
      builtIn: false,
      revision: (before?.revision ?? 0) + 1,
      manifest,
    };
    if (at >= 0) plugins[at] = info;
    else plugins.push(info);
    files.set(manifest.id, assets);
    const change = before ? "updated" : "installed";
    queueMicrotask(() =>
      emit({ event: "plugin.changed", data: { plugin: info.id, change, revision: info.revision } }),
    );
    return { plugin: structuredClone(info) };
  };
  return {
    "theme.save": ({ manifest, files: given, copyFrom }) => {
      if (!manifest.id.startsWith("local.")) throw new Error("a saved theme's id is inside local.");
      const assets = { ...(copyFrom ? files.get(copyFrom) : {}) };
      for (const f of given ?? []) assets[f.path] = f.base64;
      return install(manifest, assets);
    },
    "theme.import": ({ bundle }) => {
      if (bundle?.format !== "desk-theme/1") throw new Error("not a desk-theme/1 bundle");
      const manifest = user(bundle.manifest.id)
        ? bundle.manifest
        : { ...bundle.manifest, id: `local.${slug(bundle.manifest.name ?? bundle.manifest.id)}` };
      return install(manifest, { ...bundle.files });
    },
    "theme.export": ({ theme, inline }) => {
      const kind = (p: PluginInfo) =>
        p.manifest?.kind === "theme" || p.manifest?.kind === "design-system";
      const info = plugins.find((p) => p.id === theme && kind(p));
      if (!info?.manifest) throw new Error(`no theme ${theme}`);
      const ext = info.manifest.kind === "design-system" ? "desk-design" : "desk-theme";
      const bundle: ThemeBundle = {
        format: "desk-theme/1",
        manifest: info.manifest,
        files: { ...files.get(theme) },
      };
      return inline ? { bundle } : { path: `~/Downloads/${theme}.${ext}` };
    },
    "theme.remove": ({ theme }) => {
      const at = plugins.findIndex((p) => p.id === theme);
      if (at < 0) throw new Error(`no theme ${theme}`);
      if (!user(theme)) throw new Error(`${theme} is not a user theme`);
      const [gone] = plugins.splice(at, 1);
      files.delete(theme);
      queueMicrotask(() =>
        emit({
          event: "plugin.changed",
          data: { plugin: theme, change: "removed", revision: gone?.revision ?? 0 },
        }),
      );
      return {};
    },
    // The look in force, kept as the native core keeps it for the compositor (ADR 0146).
    "theme.tokens": (table) => {
      const key = JSON.stringify({ ...table, scope: undefined });
      if (key !== lastTable) revision += 1;
      lastTable = key;
      return { revision, tokens: Object.keys(table.tokens).length };
    },
  };
}
