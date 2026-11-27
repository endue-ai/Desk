/**
 * Settings › Notifications' row for the system's notifications (#306): whether a notice reaches the
 * OS's notifications only when endue is in the background (the default), always, or never. It sets
 * `desk.notify.system`, which the desk's page follows (`apps/desk/src/system-notices.ts`). Its words
 * are the settings catalog's (`messages/<lang>.json`, ADR 0250).
 */
import type { Settings } from "../settings";
import { h } from "../shell/dom";
import { type SettingsLanguage, settingsText } from "./copy";

export const SYSTEM_KEY = "desk.notify.system";

const CHOICES = ["background", "always", "never"] as const;
const WORDS = {
  title: "systemNoticesTitle",
  hint: "systemNoticesHint",
  background: "systemNoticesBackground",
  always: "systemNoticesAlways",
  never: "systemNoticesNever",
} as const;

/** The row: its words, and a select whose choice sets the setting. */
export function systemNoticesRow(settings: Settings, language: SettingsLanguage): HTMLElement {
  const tr = (key: keyof typeof WORDS) => settingsText(language, WORDS[key]);
  const current = settings.get<unknown>(SYSTEM_KEY, "background");
  const select = h(
    "select",
    {
      class: "input",
      "aria-label": tr("title"),
      "data-key": SYSTEM_KEY,
      onChange: () => settings.set(SYSTEM_KEY, select.value),
    },
    CHOICES.map((value) => h("option", { value }, tr(value))),
  );
  select.value = CHOICES.includes(current as (typeof CHOICES)[number])
    ? (current as string)
    : "background";
  return h(
    "div",
    { class: "settings-row" },
    h("div", { class: "settings-row-label" }, h("span", {}, tr("title")), h("p", {}, tr("hint"))),
    select,
  );
}
