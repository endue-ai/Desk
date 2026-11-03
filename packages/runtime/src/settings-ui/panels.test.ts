// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { CORE_SETTINGS } from "../core/defaults";
import { Settings } from "../settings";
import { findSections, type SettingsSection, settingsPanel } from "./panels";

describe("settings search", () => {
  it.each<[string, SettingsSection]>([
    ["화면 모드", "appearance"],
    ["Auto", "appearance"],
    ["dark mode", "appearance"],
    ["wallpaper", "appearance"],
    ["연못", "appearance"],
    ["Aurora", "appearance"],
    ["increase contrast", "accessibility"],
    ["대비 증가", "accessibility"],
    ["방해금지 모드", "notifications"],
    ["이 기기의 설정", "general"],
    ["Press a shortcut", "keyboard"],
    ["notification history", "notifications"],
  ])("finds %s in %s from displayed copy", (query, section) => {
    expect(findSections(query)).toContain(section);
  });

  it.each<[string, SettingsSection]>([
    ["preferences", "general"],
    ["theme", "appearance"],
    ["bindings", "keyboard"],
    ["focus", "notifications"],
    ["animation", "accessibility"],
    ["키바인딩", "keyboard"],
  ])("keeps the existing %s keyword for %s", (query, section) => {
    expect(findSections(query)).toContain(section);
  });

  it("matches case insensitively and returns no unrelated sections", () => {
    expect(findSections("  INCREASE   CONTRAST  ")).toContain("accessibility");
    expect(findSections("unfindable setting")).toEqual([]);
  });

  it("selects appearance first when searching for 화면", () => {
    expect(findSections("화면")[0]).toBe("appearance");
  });
});

it("offers static and live wallpaper choices in Appearance and saves a selection", () => {
  const settings = new Settings();
  settings.setDefaults(CORE_SETTINGS);
  const el = settingsPanel("appearance", settings, "en", () => {});
  const select = el.querySelector<HTMLSelectElement>('[aria-label="Wallpaper"]');
  if (!select) throw new Error("Wallpaper chooser is missing");
  expect([...select.options].map((option) => option.value)).toEqual([
    "theme",
    "grid",
    "pond",
    "aurora",
  ]);
  select.value = "pond";
  select.dispatchEvent(new Event("change"));
  expect(settings.get("desk.wallpaper.scene")).toBe("pond");
});
