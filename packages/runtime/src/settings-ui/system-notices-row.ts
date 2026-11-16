/**
 * Settings › Notifications' row for the system's notifications (#306): whether a notice reaches the
 * OS's notifications only when endue is in the background (the default), always, or never. It sets
 * `desk.notify.system`, which the desk's page follows (`apps/desk/src/system-notices.ts`). Its words
 * are here, in the `[ko, en]` pairs the settings copy keeps.
 */
import type { Settings } from "../settings";
import { h } from "../shell/dom";
import type { SettingsLanguage } from "./copy";

export const SYSTEM_KEY = "desk.notify.system";

const COPY = {
  title: ["시스템 알림에 표시", "Show in system notifications"],
  hint: [
    "endue가 보이지 않을 때 알림을 운영체제의 알림 센터에도 보냅니다.",
    "Also send notifications to your computer's notification centre.",
  ],
  background: ["endue가 백그라운드에 있을 때", "When endue is in the background"],
  always: ["항상", "Always"],
  never: ["안 함", "Never"],
} as const;

const CHOICES = ["background", "always", "never"] as const;

/** The row: its words, and a select whose choice sets the setting. */
export function systemNoticesRow(settings: Settings, language: SettingsLanguage): HTMLElement {
  const tr = (key: keyof typeof COPY) => COPY[key][language === "ko" ? 0 : 1];
  const current = settings.get<unknown>(SYSTEM_KEY, "background");
  const select = h(
    "select",
    {
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
