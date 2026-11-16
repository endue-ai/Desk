/** The theme studio's words, in the shell's two languages. */
import { type KeyOf, moduleText } from "../i18n/messages";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

export type StudioLang = "ko" | "en";

const text = moduleText("themeStudio", { en, ko });

export type StudioCopy = KeyOf<keyof typeof en, "themeStudio">;

export function studioText(lang: StudioLang, key: StudioCopy): string {
  return text(lang, key);
}
