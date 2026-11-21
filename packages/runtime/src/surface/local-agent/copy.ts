/**
 * Labels of the agent programs on this computer: the agent bar's group and each agent's screen,
 * from the surfaces' catalogs (`surface/messages`, ids `surface.localAgent.*`, ADR 0250).
 */
import { type KeyOf, moduleText } from "../../i18n/messages";
import type { Lang } from "../../shell/copy";
import en from "../messages/en.json";
import ko from "../messages/ko.json";

const text = moduleText("surface.localAgent", { en, ko });

export type LocalCopyKey = KeyOf<keyof typeof en, "surface.localAgent">;

export function localText(
  lang: Lang,
  key: LocalCopyKey,
  vars: Record<string, string | number> = {},
): string {
  return text(lang, key, vars);
}
