/** The copy of what Eris knows (ADR 0124) in Korean and English: command titles and answers. */
import { type KeyOf, moduleText } from "../i18n/messages";
import type { Lang } from "../shell/copy";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

const text = moduleText("erisContext", { en, ko });

export type ErisContextCopyKey = KeyOf<keyof typeof en, "erisContext">;

export function ec(lang: Lang, key: ErisContextCopyKey, vars: Record<string, string> = {}): string {
  return text(lang, key, vars);
}
