// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findSections, type SettingsSection } from "./panels";

describe("settings search", () => {
  it.each<[string, SettingsSection]>([
    ["화면 모드", "appearance"],
    ["Auto", "appearance"],
    ["dark mode", "appearance"],
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
});
