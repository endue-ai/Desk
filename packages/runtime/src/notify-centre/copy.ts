/**
 * What the notification centre says (#307, ADR 0250): its control, its panel's header and groups,
 * and its rows' Dismiss, from the catalogs beside it, in the desk's language.
 */
import type { Language, MessageParams } from "@endue-ai/bridge";
import { type KeyOf, moduleText } from "../i18n/messages";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

const text = moduleText("notifyCentre", { en, ko });

export type CentreCopyKey = KeyOf<keyof typeof en, "notifyCentre">;

export function centreText(lang: Language, key: CentreCopyKey, params?: MessageParams): string {
  return text(lang, key, params);
}
