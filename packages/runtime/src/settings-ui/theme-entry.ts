/** The shell's theme studio is reached through Appearance when its command is available. */
import type { Commands } from "../commands";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import type { SettingsLanguage } from "./copy";
import { settingsIcon } from "./icons";

export function themeSettingsEntry(
  commands: Commands,
  close: () => void,
  language: SettingsLanguage,
): HTMLElement | null {
  if (!commands.has("desk.theme.studio")) return null;
  const title = language === "ko" ? "테마" : "Themes";
  return h(
    "section",
    { class: "settings-group" },
    h("h3", {}, title),
    h(
      "div",
      { class: "settings-group-rows" },
      h(
        "button",
        {
          class: "settings-link",
          type: "button",
          "data-key": "settings-themes",
          onClick: () => {
            close();
            void commands.run("desk.theme.studio").catch(() => {});
          },
        },
        icon("palette", 18),
        h("span", {}, title),
        settingsIcon("chevron", 14),
      ),
    ),
  );
}
