// @vitest-environment jsdom
// Settings › Notifications has one row for the system's notifications (#306): when endue is in the
// background (the default), always or never, which sets desk.notify.system.
import { describe, expect, it } from "vitest";
import { CORE_SETTINGS } from "../core/defaults";
import { Settings } from "../settings";
import { settingsPanel } from "./panels";

const panel = (language: "en" | "ko" = "en") => {
  const settings = new Settings();
  settings.setDefaults(CORE_SETTINGS);
  const el = settingsPanel("notifications", settings, language, () => {});
  const selects = el.querySelectorAll<HTMLSelectElement>('[data-key="desk.notify.system"]');
  return { settings, el, selects };
};

describe("Settings › Notifications", () => {
  it("has one row for the system's notifications", () => {
    const { settings, selects } = panel();
    expect(selects).toHaveLength(1);
    const select = selects[0] as HTMLSelectElement;
    expect(select.getAttribute("aria-label")).toBe("Show in system notifications");
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ["background", "When endue is in the background"],
      ["always", "Always"],
      ["never", "Never"],
    ]);
    expect(select.value).toBe("background");

    for (const value of ["always", "never", "background"]) {
      select.value = value;
      select.dispatchEvent(new Event("change"));
      expect(settings.get("desk.notify.system")).toBe(value);
    }
  });

  it("shows the choice in force, and reads in Korean", () => {
    const { settings } = panel();
    settings.set("desk.notify.system", "never");
    const el = settingsPanel("notifications", settings, "ko", () => {});
    const select = el.querySelector<HTMLSelectElement>('[data-key="desk.notify.system"]');
    expect(select?.value).toBe("never");
    expect(select?.getAttribute("aria-label")).toBe("시스템 알림에 표시");
  });
});
