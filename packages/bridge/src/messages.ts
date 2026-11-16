// The one lookup for message catalogs (specs/plugin/v0/messages.schema.json, ADR 0250): the desk's
// runtime and every plugin, through the SDK, read their words with it.
import type { Message, MessageCatalog } from "./generated";

/** The languages the desk speaks. English comes first: it is the fallback. */
export const LANGUAGES = ["en", "ko"] as const;
export type Language = (typeof LANGUAGES)[number];
/** What the desk.language setting holds: a language, or the OS's. */
export type LanguageChoice = "system" | Language;

/** One catalog per language; English is the one every other falls back to. */
export type Catalogs = Partial<Record<Language, MessageCatalog>>;
export type MessageParams = Record<string, string | number>;

const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

/**
 * The language in force: the one chosen, or with `system` (or nothing) the first of the OS's
 * preferred languages (BCP 47 tags, `navigator.languages`) the desk speaks, else English.
 */
export function resolveLanguage(
  choice: string | undefined,
  preferred: readonly string[],
): Language {
  if (isLanguage(choice)) return choice;
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(primary)) return primary;
  }
  return "en";
}

const rules = new Map<Language, Intl.PluralRules>();
function plural(language: Language, count: number): Intl.LDMLPluralRule {
  let rule = rules.get(language);
  if (!rule) {
    rule = new Intl.PluralRules(language);
    rules.set(language, rule);
  }
  return rule.select(count);
}

function text(message: Message, language: Language, params: MessageParams | undefined): string {
  if (typeof message === "string") return message;
  const count = Number(params?.count);
  if (!Number.isFinite(count)) return message.other;
  return message[plural(language, count)] ?? message.other;
}

/** Each {name} replaced by its parameter; one not given reads as nothing. */
export function fill(template: string, params: MessageParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}

/**
 * Message `id` in `language`, filled with `params`: from that language's catalog, else English's
 * (in English's plural rules), else the id itself, so a missing message shows where it is missing.
 * Without `params` the text stays as written, {name} and all, for a caller that fills it later.
 */
export function messageText(
  catalogs: Catalogs,
  language: Language,
  id: string,
  params?: MessageParams,
): string {
  const own = catalogs[language]?.[id];
  const [message, rules] = own !== undefined ? [own, language] : [catalogs.en?.[id], "en" as const];
  if (message === undefined) return id;
  const chosen = text(message, rules, params);
  return params ? fill(chosen, params) : chosen;
}

/** Several catalogs in one, per language; a later catalog's id replaces an earlier one's. */
export function mergeCatalogs(...all: Catalogs[]): Catalogs {
  const out: Catalogs = {};
  for (const catalogs of all)
    for (const language of LANGUAGES) {
      const catalog = catalogs[language];
      if (catalog) out[language] = { ...out[language], ...catalog };
    }
  return out;
}
