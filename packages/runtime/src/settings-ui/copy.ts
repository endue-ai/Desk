/** The settings window's words, from its catalogs (messages/, ADR 0250). */
import { type KeyOf, moduleText } from "../i18n/messages";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

export type SettingsLanguage = "ko" | "en";

const text = moduleText("settingsUi", { en, ko });

export type SettingsCopy = Exclude<KeyOf<keyof typeof en, "settingsUi">, `account.${string}`>;

export const settingsText = (lang: SettingsLanguage, key: SettingsCopy): string => text(lang, key);
