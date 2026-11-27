/** Eris's words in the desk's two languages. */
import { type KeyOf, moduleText } from "../i18n/messages";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

type ErisLang = "ko" | "en";

const text = moduleText("eris", { en, ko });
type Id = KeyOf<keyof typeof en, "eris">;

export const erisText = (lang: ErisLang, key: Id) => text(lang, key);
