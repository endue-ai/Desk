/** What a window says of a frame that stopped answering (#39): the question, its actions, Reload. */
import { type KeyOf, moduleText } from "../i18n/messages";
import type { Lang } from "../shell/copy";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

const text = moduleText("frames", { en, ko });

export type FramesCopyKey = KeyOf<keyof typeof en, "frames">;

export function framesText(
  lang: Lang,
  key: FramesCopyKey,
  vars: Record<string, string | number> = {},
): string {
  return text(lang, key, vars);
}
