import {
  type Catalogs,
  type Language,
  type MessageCatalog,
  messageText,
  type PluginInfo,
} from "@endue-ai/bridge";
import type { PluginHostOptions } from "./plugin-host-deps";

function hasTitleMessages({ manifest }: PluginInfo): boolean {
  return (
    !!manifest?.messages &&
    (manifest.surfaces?.some((surface) => surface.titleMessage) === true ||
      manifest.contributes?.commands?.some((command) => command.titleMessage) === true)
  );
}

/** Read manifest titles before the desk registers commands or opens a plugin surface. */
export function readTitleMessages(url: PluginHostOptions["url"], language: () => Language) {
  const cache = new Map<string, Promise<MessageCatalog | undefined>>();
  const read = (target: string) => {
    let pending = cache.get(target);
    if (!pending) {
      pending = fetch(target)
        .then(async (response) => {
          if (!response.ok) return undefined;
          const value: unknown = await response.json();
          if (value && typeof value === "object" && !Array.isArray(value))
            return value as MessageCatalog;
        })
        .catch(() => undefined);
      cache.set(target, pending);
      const oldest = cache.keys().next().value;
      if (cache.size > 40 && oldest !== undefined) cache.delete(oldest);
    }
    return pending;
  };

  async function localize(info: PluginInfo, current: Language): Promise<PluginInfo> {
    const manifest = info.manifest;
    const folder = manifest?.messages;
    if (!manifest || !folder) return info;
    const surfaces = manifest.surfaces;
    const contributes = manifest.contributes;
    const commands = contributes?.commands;
    if (!hasTitleMessages(info)) return info;
    const catalog = (lang: Language) =>
      read(url(info.id, `${folder}/${lang}.json`, info.revision, surfaces?.[0]?.id ?? "main"));
    const [en, local] = await Promise.all([
      catalog("en"),
      current === "en" ? undefined : catalog(current),
    ]);
    const sources: Catalogs = { en, ...(current !== "en" && { [current]: local }) };
    const title = (key: string, fallback: string | undefined) => {
      const titleCatalogs: Catalogs = {};
      for (const lang of ["en", current] as const) {
        const source = sources[lang];
        const message = source && Object.hasOwn(source, key) ? source[key] : undefined;
        if (typeof message === "string" || (message && typeof message.other === "string"))
          titleCatalogs[lang] = { [key]: message };
      }
      if (!titleCatalogs.en && !titleCatalogs[current]) return fallback;
      return messageText(titleCatalogs, current, key) || fallback;
    };
    return {
      ...info,
      manifest: {
        ...manifest,
        ...(surfaces && {
          surfaces: surfaces.map((surface) =>
            surface.titleMessage
              ? { ...surface, title: title(surface.titleMessage, surface.title) }
              : surface,
          ),
        }),
        ...(contributes &&
          commands && {
            contributes: {
              ...contributes,
              commands: commands.map((command) =>
                command.titleMessage
                  ? {
                      ...command,
                      title: title(command.titleMessage, command.title) ?? command.title,
                    }
                  : command,
              ),
            },
          }),
      },
    };
  }

  async function inCurrentLanguage(plugins: PluginInfo[]): Promise<PluginInfo[]> {
    const current = language();
    const listed = await Promise.all(plugins.map((plugin) => localize(plugin, current)));
    return current === language() ? listed : inCurrentLanguage(plugins);
  }
  // Preserve synchronous listing for manifests without message titles.
  return (plugins: PluginInfo[]) =>
    plugins.some(hasTitleMessages) ? inCurrentLanguage(plugins) : plugins;
}
