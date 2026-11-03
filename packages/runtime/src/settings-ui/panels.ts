import type { Settings } from "../settings";
import { h } from "../shell/dom";
import { type SettingsCopy, type SettingsLanguage, settingsText } from "./copy";
import { settingsIcon } from "./icons";

export const SECTIONS = [
  "general",
  "appearance",
  "keyboard",
  "notifications",
  "accessibility",
] as const;
export type SettingsSection = (typeof SECTIONS)[number];
export const description = (section: SettingsSection): SettingsCopy => `${section}Description`;
const TERMS: Record<SettingsSection, string> = {
  general: "general desk preferences 일반 설정 정보",
  appearance: "appearance theme light dark system 화면 테마 라이트 다크 자동",
  keyboard: "keyboard keys shortcuts bindings 키보드 단축키 키바인딩",
  notifications: "notifications focus do not disturb 알림 방해금지 집중",
  accessibility: "accessibility contrast motion animation 손쉬운 사용 대비 동작 애니메이션",
};
export function findSections(query: string): SettingsSection[] {
  const words = query.trim().toLowerCase().split(/\s+/);
  return SECTIONS.filter((section) => words.every((word) => TERMS[section].includes(word)));
}

export function settingsPanel(
  section: SettingsSection,
  settings: Settings,
  language: SettingsLanguage,
  navigate: (section: SettingsSection) => void,
): HTMLElement {
  const tr = (key: SettingsCopy) => settingsText(language, key);
  const group = (title: SettingsCopy, ...rows: HTMLElement[]) =>
    h(
      "section",
      { class: "settings-group" },
      h("h3", {}, tr(title)),
      h("div", { class: "settings-group-rows" }, rows),
    );
  const row = (title: SettingsCopy, hint: SettingsCopy | undefined, control: HTMLElement) =>
    h(
      "div",
      { class: "settings-row" },
      h(
        "div",
        { class: "settings-row-label" },
        h("span", {}, tr(title)),
        hint ? h("p", {}, tr(hint)) : null,
      ),
      control,
    );
  const select = (key: string, title: SettingsCopy, choices: [string, SettingsCopy][]) => {
    const el = h(
      "select",
      { "aria-label": tr(title), "data-key": key, onChange: () => settings.set(key, el.value) },
      choices.map(([value, label]) => h("option", { value }, tr(label))),
    );
    el.value = settings.get<string>(key);
    return el;
  };
  const link = (target: SettingsSection, label: SettingsCopy = target) =>
    h(
      "button",
      { class: "settings-link", type: "button", onClick: () => navigate(target) },
      h("span", { class: `settings-category-icon ${target}` }, settingsIcon(target)),
      h("span", {}, tr(label)),
      settingsIcon("chevron", 14),
    );
  const el = h("div", { class: "settings-panel-body" });
  if (section === "general") {
    el.append(
      h(
        "div",
        { class: "settings-about" },
        h(
          "div",
          { class: "settings-app-icon", "aria-hidden": "true" },
          settingsIcon("general", 40),
        ),
        h("h2", {}, "endue Desk"),
        h("p", {}, tr("device")),
      ),
      group(
        "personalization",
        link("appearance"),
        link("keyboard", "shortcuts"),
        link("accessibility"),
      ),
      h("p", { class: "settings-footnote" }, tr("local")),
    );
  } else if (section === "appearance") {
    const current = settings.get<string>("desk.theme.scheme");
    el.append(
      group(
        "appearance",
        h(
          "div",
          { class: "settings-appearances", role: "group", "aria-label": tr("appearance") },
          (["light", "dark", "system"] as const).map((scheme) =>
            h(
              "button",
              {
                type: "button",
                class: `settings-appearance-choice${current === scheme ? " selected" : ""}`,
                "aria-pressed": String(current === scheme),
                "data-key": `appearance-${scheme}`,
                onClick: () => settings.set("desk.theme.scheme", scheme),
              },
              h(
                "span",
                { class: `settings-preview ${scheme}`, "aria-hidden": "true" },
                h("i", {}),
                h("b", {}, h("i", {}), h("i", {}), h("i", {})),
              ),
              h("span", {}, tr(scheme)),
            ),
          ),
        ),
      ),
      h("p", { class: "settings-footnote" }, tr("systemHint")),
    );
  } else if (section === "notifications") {
    const enabled = settings.get<boolean>("desk.notify.dnd");
    el.append(
      group(
        "behavior",
        row(
          "dnd",
          "dndHint",
          h(
            "button",
            {
              class: "settings-toggle",
              type: "button",
              role: "switch",
              "aria-label": tr("dnd"),
              "aria-checked": String(enabled),
              "data-key": "dnd",
              onClick: () => settings.set("desk.notify.dnd", !enabled),
            },
            h("span", {}),
          ),
        ),
      ),
      h("p", { class: "settings-footnote" }, tr("historyHint")),
    );
  } else if (section === "accessibility") {
    el.append(
      group(
        "display",
        row(
          "contrast",
          "contrastHint",
          select("desk.theme.contrast", "contrast", [
            ["system", "followSystem"],
            ["normal", "normal"],
            ["high", "high"],
          ]),
        ),
        row(
          "motion",
          "motionHint",
          select("desk.theme.motion", "motion", [
            ["system", "followSystem"],
            ["reduce", "reduce"],
            ["full", "full"],
          ]),
        ),
      ),
    );
  }
  return el;
}
