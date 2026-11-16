// The runtime's words come from catalogs beside each module (`<module>/messages/<lang>.json`, ADR
// 0250), read with the one lookup the plugins' SDK uses too (@endue-ai/bridge `messageText`).
import { type Language, type MessageParams, messageText } from "@endue-ai/bridge";

/** A module's catalogs as JSON imports give them: English whole, Korean perhaps not. */
export interface ModuleCatalogs<Id extends string> {
  en: Record<Id, string | { other: string; [form: string]: string }>;
  ko?: Partial<Record<Id, unknown>>;
}

/** The part of an id after its module's prefix: `frames.stop` is `stop` in frames. */
export type KeyOf<Id extends string, P extends string> = Id extends `${P}.${infer K}` ? K : never;

/**
 * A module's lookup: `text(lang, key, params)` reads `<prefix>.<key>` in `lang`, else in English.
 * The keys are the module's English ids without the prefix, so a typo is a type error.
 */
export function moduleText<Id extends string, P extends string>(
  prefix: P,
  catalogs: ModuleCatalogs<Id>,
): (lang: Language, key: KeyOf<Id, P>, params?: MessageParams) => string {
  const all = catalogs as Parameters<typeof messageText>[0];
  return (lang, key, params) => messageText(all, lang, `${prefix}.${key}`, params);
}
