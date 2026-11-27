/** The shortcut bar's words (ADR 0274), from the system module's catalogs (ADR 0250). */
import { type KeyOf, moduleText } from "../i18n/messages";
import type { Lang } from "../shell/copy";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

const text = moduleText("system", { en, ko });

type Id = KeyOf<keyof typeof en, "system">;
export type ShortcutKey = KeyOf<Id, "shortcuts">;

export const shortcutText = (
  lang: Lang,
  key: ShortcutKey,
  params?: Record<string, string | number>,
): string => text(lang, `shortcuts.${key}` as Id, params);

/** The bar's own names for the desk's actions it offers (shortcuts.ts SUGGESTED). */
const NAMES: Record<string, ShortcutKey> = {
  "desk.palette.open": "search",
  "endue.launcher.open": "launcher",
  "desk.settings.open": "settings",
  "desk.inbox.open": "inbox",
  "desk.theme.studio": "themes",
};

/** The bar's name for one of the desk's actions in `lang`, or undefined for any other command. */
export function deskName(lang: Lang, command: string): string | undefined {
  const key = NAMES[command];
  return key ? shortcutText(lang, key) : undefined;
}
