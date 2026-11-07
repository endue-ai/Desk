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
  "connections",
  "market",
] as const;
export type SettingsSection = (typeof SECTIONS)[number];
export const description = (section: SettingsSection): SettingsCopy => `${section}Description`;
const TERMS: Record<SettingsSection, string> = {
  general: "general desk preferences 일반 설정 정보",
  appearance:
    "appearance theme light dark system dark mode wallpaper live pond aurora 화면 테마 라이트 다크 자동 배경화면 라이브 연못 오로라",
  keyboard: "keyboard keys shortcuts bindings 키보드 단축키 키바인딩",
  notifications: "notifications focus do not disturb 알림 방해금지 집중",
  accessibility: "accessibility contrast motion animation 손쉬운 사용 대비 동작 애니메이션",
  connections:
    "connections connectors accounts token github sources sync 연결 커넥터 계정 토큰 동기화 소스",
  market: "market install views packs plugins themes store 마켓 설치 뷰 팩 플러그인 테마",
};
const SECTION_COPY: Record<SettingsSection, readonly SettingsCopy[]> = {
  general: ["general", "generalDescription", "device", "personalization", "local"],
  appearance: [
    "appearance",
    "appearanceDescription",
    "light",
    "dark",
    "system",
    "systemHint",
    "wallpaper",
    "wallpaperHint",
    "wallpaperTheme",
    "wallpaperGrid",
    "wallpaperPond",
    "wallpaperAurora",
  ],
  keyboard: [
    "keyboard",
    "keyboardDescription",
    "shortcuts",
    "shortcutHint",
    "findCommand",
    "change",
    "reset",
    "resetAll",
    "restoreConfirm",
    "restore",
    "remove",
    "none",
    "record",
    "invalid",
    "conflict",
    "replace",
    "cancel",
    "moved",
    "noResults",
    "trySearch",
  ],
  notifications: [
    "notifications",
    "notificationsDescription",
    "behavior",
    "dnd",
    "dndHint",
    "historyHint",
  ],
  accessibility: [
    "accessibility",
    "accessibilityDescription",
    "display",
    "contrast",
    "contrastHint",
    "normal",
    "high",
    "followSystem",
    "motion",
    "motionHint",
    "reduce",
    "full",
  ],
  connections: ["connections", "connectionsDescription"],
  market: ["market", "marketDescription"],
};
const SEARCH_TEXT = Object.fromEntries(
  SECTIONS.map((section) => [
    section,
    [
      TERMS[section],
      ...SECTION_COPY[section].flatMap((key) => [settingsText("ko", key), settingsText("en", key)]),
    ]
      .join(" ")
      .toLowerCase(),
  ]),
) as Record<SettingsSection, string>;
export function findSections(query: string): SettingsSection[] {
  const words = query.trim().toLowerCase().split(/\s+/);
  return SECTIONS.filter((section) => words.every((word) => SEARCH_TEXT[section].includes(word)));
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
      group(
        "wallpaper",
        row(
          "wallpaper",
          "wallpaperHint",
          select("desk.wallpaper.scene", "wallpaper", [
            ["theme", "wallpaperTheme"],
            ["grid", "wallpaperGrid"],
            ["pond", "wallpaperPond"],
            ["aurora", "wallpaperAurora"],
          ]),
        ),
      ),
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
