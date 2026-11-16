/** The desktops' copy (ADR 0117) in Korean and English, from their catalogs (messages/, ADR 0250):
 * short, the person as subject, verbs on buttons. */
import { type KeyOf, moduleText } from "../i18n/messages";
import type { Lang } from "../shell/copy";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

const text = moduleText("desktops", { en, ko });

export type DesktopsCopyKey = KeyOf<keyof typeof en, "desktops">;

export function dt(lang: Lang, key: DesktopsCopyKey, vars: Record<string, string | number> = {}) {
  return text(lang, key, vars);
}
