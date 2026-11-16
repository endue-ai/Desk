/**
 * Settings › General's Language row (desk.language, ADR 0250): Follow the system, English, 한국어.
 * Each language is named in itself; a choice is kept as the core settings are and is in force at
 * once, and the row shows a change made elsewhere (init.yaml, the CLI, another window).
 */
import type { Preferences } from "../core/preferences";
import { LANGUAGE_SETTING } from "../policies/language";
import type { Settings } from "../settings";
import { h } from "../shell/dom";
import { type SettingsLanguage, settingsText } from "./copy";

export interface LanguageRowDeps {
  settings: Pick<Settings, "get" | "onChange">;
  preferences: Pick<Preferences, "set">;
  language: SettingsLanguage;
}

export function languageRow({ settings, preferences, language }: LanguageRowDeps): HTMLElement {
  const tr = (key: Parameters<typeof settingsText>[1]) => settingsText(language, key);
  const choices = [
    ["system", tr("languageSystem")],
    ["en", tr("languageEn")],
    ["ko", tr("languageKo")],
  ] as const;
  const select = h(
    "select",
    {
      class: "input",
      "aria-label": tr("language"),
      "data-key": `setting-${LANGUAGE_SETTING}`,
      onChange: () => preferences.set(LANGUAGE_SETTING, select.value),
    },
    choices.map(([value, label]) => h("option", { value }, label)),
  );
  const show = () => {
    select.value = settings.get<string>(LANGUAGE_SETTING, "system");
  };
  show();
  const row = h(
    "div",
    { class: "settings-row", "data-setting": LANGUAGE_SETTING },
    h(
      "div",
      { class: "settings-row-label", title: LANGUAGE_SETTING },
      h("span", {}, tr("language")),
      h("p", {}, tr("languageHint")),
    ),
    h("div", { class: "settings-declared-control" }, select),
  );
  // Until the row leaves the page: it is drawn again with the panel.
  const off = settings.onChange((keys) => {
    if (!keys.includes(LANGUAGE_SETTING)) return;
    if (row.isConnected) show();
    else off();
  });
  return h("section", { class: "settings-group" }, h("div", { class: "settings-group-rows" }, row));
}
