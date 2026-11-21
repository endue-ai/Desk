/**
 * Words of the person's endue agents and spaces: the agent bar's buttons and their windows' cards,
 * from the surfaces' catalogs (`surface/messages`, ids `surface.endue.*`, ADR 0250).
 */
import { type KeyOf, moduleText } from "../../i18n/messages";
import type { Lang } from "../../shell/copy";
import en from "../messages/en.json";
import ko from "../messages/ko.json";

const text = moduleText("surface.endue", { en, ko });
const surface = moduleText("surface", { en, ko });

export type EndueKey = KeyOf<keyof typeof en, "surface.endue">;

export function endueText(
  lang: Lang,
  key: EndueKey,
  vars: Record<string, string | number> = {},
): string {
  return text(lang, key, vars);
}

/** The locale a day is written in for `lang` (`surface.locale`): en-US, ko-KR. */
export const endueLocale = (lang: Lang) => surface(lang, "locale");
