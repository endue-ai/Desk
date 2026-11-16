// ctx.messages: a plugin's words from its own catalogs (the manifest's `messages` folder, one
// <language>.json each; specs/plugin/v0/messages.schema.json, ADR 0250), in the desk's language,
// read with the lookup the desk's runtime uses (@endue-ai/bridge messageText).
import {
  type Catalogs,
  LANGUAGES,
  type Language,
  type MessageCatalog,
  type MessageParams,
  messageText,
} from "@endue-ai/bridge";

export interface PluginMessages {
  /** Message `id` in the desk's language, else English, else the id itself. */
  t(id: string, params?: MessageParams): string;
  /** The desk's language now. */
  language(): Language;
  /** Hear each change of the desk's language, once its catalog is in; the function stops. */
  onChange(listener: (language: Language) => void): () => void;
  /** Resolves once the catalogs of the language in force are in. */
  readonly ready: Promise<void>;
}

/** Reads one catalog file by its path under the plugin's folder; undefined when there is none. */
export type CatalogLoader = (path: string) => Promise<unknown> | undefined;

const isLanguage = (value: unknown): value is Language =>
  (LANGUAGES as readonly unknown[]).includes(value);

/** A plugin's messages: `folder` is its manifest's `messages`, absent when it ships none. */
export function messagesFor(options: {
  language?: unknown;
  folder?: string;
  load?: CatalogLoader;
}): PluginMessages & { set(language: unknown): void } {
  const { folder, load } = options;
  const catalogs: Catalogs = {};
  const listeners = new Set<(language: Language) => void>();
  let current: Language = isLanguage(options.language) ? options.language : "en";
  let asked = current;
  const fetchOne = async (language: Language) => {
    if (!folder || !load || catalogs[language]) return;
    const path = `${folder.replace(/\/+$/, "")}/${language}.json`;
    const catalog = await Promise.resolve(load(path)).catch(() => undefined);
    if (catalog && typeof catalog === "object") catalogs[language] = catalog as MessageCatalog;
  };
  // English is every other language's fallback, so it comes in too.
  const bring = (language: Language) => Promise.all([fetchOne("en"), fetchOne(language)]);
  const api = {
    ready: bring(current).then((): void => undefined) as Promise<void>,
    t: (id: string, params?: MessageParams) => messageText(catalogs, current, id, params),
    language: () => current,
    onChange: (listener: (language: Language) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (language: unknown) => {
      if (!isLanguage(language) || language === asked) return;
      asked = language;
      api.ready = bring(language).then(() => {
        // A later change asked in the meantime wins.
        if (asked !== language || current === language) return;
        current = language;
        for (const listener of [...listeners]) listener(language);
      });
    },
  };
  return api;
}
