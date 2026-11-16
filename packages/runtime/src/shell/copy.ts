/** Shell copy in Korean and English, from the shell's catalogs (messages/, ADR 0250). Short
 * statements, the user as subject, verbs on buttons. */
import { type KeyOf, moduleText } from "../i18n/messages";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

export type Lang = "ko" | "en";

const text = moduleText("shell", { en, ko });

type Id = KeyOf<keyof typeof en, "shell">;
/** The shell's own words; the new-agent bar's (`bar.*`, bar-new.ts) and the talk line's stay theirs. */
export type CopyKey = Exclude<Id, `bar.${string}`>;

export function t(lang: Lang, key: CopyKey, vars: Record<string, string | number> = {}): string {
  return text(lang, key, vars);
}

/** Any of the shell's words, the new-agent bar's included. */
export const shellText = (lang: Lang, key: Id, vars?: Record<string, string | number>) =>
  text(lang, key, vars);
