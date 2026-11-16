// @vitest-environment jsdom
// desk.settings.find: the palette's Settings group (#304). The sections and the rows plugins
// declare, found by their words, each opening Settings at that section and row.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../settings";
import { pluginSettings } from "./declared";
import { revealRow, settingsResults } from "./find";

const hub = {
  policy: {
    settings: {
      "endue.calendar.week-start": {
        owner: "endue.calendar",
        kind: "string",
        default: "monday",
        description: "The first day of the week",
      },
      "endue.notes.wrap": { owner: "endue.notes", kind: "boolean", default: true },
    },
  },
  plugins: [
    { id: "endue.calendar", manifest: { name: "Calendar" } },
    { id: "endue.notes", manifest: { name: "Notes" } },
  ],
  settings: new Settings(),
} as never;

afterEach(() => {
  document.body.replaceChildren();
});

describe("desk.settings.find", () => {
  it("lists the sections and the rows plugins declare", () => {
    expect(settingsResults("week", { hub, language: "en" })).toEqual([
      {
        id: "setting:endue.calendar.week-start",
        title: "Week start",
        detail: "Settings › Plugins · Calendar",
        kind: "setting",
        actions: [
          {
            command: "desk.settings.open",
            title: "Open in Settings",
            args: { section: "plugins", row: "endue.calendar.week-start" },
          },
        ],
      },
    ]);
    const keyboard = settingsResults("keyboard", { hub, language: "en" });
    expect(keyboard[0]).toMatchObject({
      id: "settings:keyboard",
      title: "Keyboard",
      actions: [{ command: "desk.settings.open", args: { section: "keyboard" } }],
    });
    // The palette's own key is a row of Settings › Keyboard.
    expect(settingsResults("search desk", { hub, language: "en" }).map((r) => r.id)).toContain(
      "setting:desk.palette.shortcut",
    );
    expect(settingsResults("", { hub, language: "en" })).toEqual([]);
    expect(settingsResults("zzzz", { hub, language: "en" })).toEqual([]);
    expect(settingsResults("e", { hub, language: "en" }, 2)).toHaveLength(2);
  });

  it("desk.settings.open with a row opens Settings at that row", () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const panel = pluginSettings({ hub, preferences: { set() {} }, language: "en" });
    document.body.append(panel);
    expect(revealRow(panel, "endue.calendar.week-start")).toBe(true);
    const control = panel.querySelector('[data-key="setting-endue.calendar.week-start"]');
    expect(document.activeElement).toBe(control);
    expect(scrolled).toHaveBeenCalled();
    expect(control?.closest(".settings-row")?.classList.contains("found")).toBe(true);
    expect(revealRow(panel, "endue.nothing")).toBe(false);
  });
});
