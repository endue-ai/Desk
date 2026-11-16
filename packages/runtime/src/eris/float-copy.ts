/** The floating Eris's words (ADR 0121), in the desk's two languages, from Eris's catalogs (messages/). */
import { type KeyOf, moduleText } from "../i18n/messages";
import type { FloatStatus } from "./float";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

export type FloatLang = "ko" | "en";

const text = moduleText("eris", { en, ko });
type Id = KeyOf<keyof typeof en, "eris">;

export type FloatCopy = KeyOf<Id, "float">;

export function floatText(lang: FloatLang, key: FloatCopy, vars: Record<string, string> = {}) {
  return text(lang, `float.${key}`, vars);
}

export function statusText(lang: FloatLang, status: FloatStatus): string {
  return text(lang, `status.${status}`);
}

/** Any of Eris's words: what she said (`said.*`) and heard (`talk.*`). */
export const erisText = (lang: FloatLang, key: Id) => text(lang, key);
