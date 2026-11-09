// @vitest-environment jsdom
// Settings › Plugins and General's generated rows: drawn from what plugins and the core declare
// (`contributes.settings`), in force at once in the runtime's settings and kept in the preferences
// record like the core settings (specs/runtime/v0/settings.md).
import type { PluginManifest, SettingContribution } from "@endue-ai/bridge";
import { afterEach, describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { CORE_SETTINGS } from "../core/defaults";
import { Preferences } from "../core/preferences";
import { PolicyHub } from "../hub";
import { coreSettings, declaredSearch, pluginSettings } from "./declared";
import { findSections } from "./panels";

const sample: PluginManifest = {
  id: "endue.sample",
  name: "Sample",
  version: "1.0.0",
  kind: "ui",
  contributes: {
    settings: {
      "endue.sample.reminders": {
        kind: "boolean",
        default: true,
        description: "Show a notification when a reminder is due.",
      },
      "endue.sample.week-start": {
        kind: "string",
        default: "locale",
        choices: ["locale", "sunday", "monday"],
        description: "The first day of the week.",
      },
      "endue.sample.page": {
        kind: "integer",
        default: 50,
        minimum: 10,
        maximum: 500,
        description: "How many rows a page holds.",
      },
      "endue.sample.zoom": {
        kind: "number",
        default: 1,
        minimum: 0.5,
        maximum: 3,
        description: "How big the text is drawn.",
      },
      "endue.sample.signature": {
        kind: "string",
        default: "",
        pattern: "^[^<>]*$",
        description: "The line under every message.",
      },
      "endue.sample.folders": { kind: "array", default: [], description: "Folders to watch." },
    },
  },
};
const notify: PluginManifest = {
  id: "desk.notify",
  name: "Notifications",
  version: "1.0.0",
  kind: "policy",
  contributes: {
    settings: {
      "desk.notify.dnd": { kind: "boolean", default: false },
      "desk.notify.history": {
        kind: "integer",
        default: 200,
        description: "How many past notifications to keep.",
      },
    },
  },
};
const off: PluginManifest = {
  id: "endue.off",
  name: "Off",
  version: "1.0.0",
  kind: "ui",
  contributes: { settings: { "endue.off.mode": { kind: "boolean", default: false } } },
};

const hubs: PolicyHub[] = [];
afterEach(() => {
  document.body.replaceChildren();
  for (const hub of hubs.splice(0)) hub.commands.dispose();
});

/** The runtime's start: init.yaml and the record read, then the plugins listed. */
async function setup(data: Record<string, unknown> = {}, init: Record<string, unknown> = {}) {
  const core = browserCore({
    manifests: [sample, notify, off],
    off: ["endue.off"],
    store: memoryStore(data),
    init: { settings: init },
  });
  const hub = new PolicyHub(core.client);
  hubs.push(hub);
  const preferences = new Preferences(hub.settings, core.client);
  await Promise.all([hub.readInit(core.client), preferences.load()]);
  hub.apply(core.plugins);
  return { hub, preferences, data };
}

/** In the document, as the window shows it: a checkbox only toggles there. */
function shown<T extends HTMLElement | null>(el: T): T {
  if (el) document.body.append(el);
  return el;
}
const rows = (el: ParentNode) =>
  [...el.querySelectorAll<HTMLElement>("[data-setting]")].map((row) => row.dataset.setting);
function control<T extends HTMLElement>(el: ParentNode, key: string): T {
  const found = el.querySelector<T>(`[data-setting="${key}"] :is(input, select)`);
  if (!found) throw new Error(`no control for ${key}`);
  return found;
}
function change(input: HTMLInputElement | HTMLSelectElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("change"));
}

describe("Settings, Plugins", () => {
  it("renders each enabled plugin's settings as controls with title and description", async () => {
    const { hub, preferences } = await setup();
    const el = shown(pluginSettings({ hub, preferences, language: "en" }));
    const groups = [...el.querySelectorAll<HTMLElement>("[data-plugin]")];
    expect(groups.map((g) => [g.dataset.plugin, g.querySelector("h3")?.textContent])).toEqual([
      ["desk.notify", "Notifications"],
      ["endue.sample", "Sample"],
    ]);
    // Keys the core declares stay in their own panels; arrays are left to init.yaml.
    expect(rows(el)).toEqual([
      "desk.notify.history",
      "endue.sample.reminders",
      "endue.sample.week-start",
      "endue.sample.page",
      "endue.sample.zoom",
      "endue.sample.signature",
    ]);
    const week = el.querySelector<HTMLElement>('[data-setting="endue.sample.week-start"]');
    expect(week?.querySelector(".settings-row-label > span")?.textContent).toBe("Week start");
    expect(week?.querySelector(".settings-row-label p")?.textContent).toBe(
      "The first day of the week.",
    );
    expect(week?.querySelector("code")?.textContent).toBe("endue.sample.week-start");
    const reminders = control<HTMLInputElement>(el, "endue.sample.reminders");
    expect([reminders.type, reminders.checked, reminders.getAttribute("aria-label")]).toEqual([
      "checkbox",
      true,
      "Reminders",
    ]);
    const select = control<HTMLSelectElement>(el, "endue.sample.week-start");
    expect([...select.options].map((o) => o.value)).toEqual(["locale", "sunday", "monday"]);
    expect(select.value).toBe("locale");
    const page = control<HTMLInputElement>(el, "endue.sample.page");
    expect([page.type, page.min, page.max, page.step, page.value]).toEqual([
      "number",
      "10",
      "500",
      "1",
      "50",
    ]);
    const zoom = control<HTMLInputElement>(el, "endue.sample.zoom");
    expect([zoom.type, zoom.min, zoom.max, zoom.step]).toEqual(["number", "0.5", "3", "any"]);
    expect(control<HTMLInputElement>(el, "endue.sample.signature").type).toBe("text");
    expect(el.querySelector('[data-plugin="endue.off"]')).toBeNull();
  });

  it("an edit applies at once and survives a reload of the preferences", async () => {
    const init = { "desk.notify.history": 50 };
    const { hub, preferences, data } = await setup({}, init);
    const el = shown(pluginSettings({ hub, preferences, language: "en" }));
    change(control(el, "endue.sample.week-start"), "monday");
    expect(hub.settings.get("endue.sample.week-start")).toBe("monday");
    control<HTMLInputElement>(el, "endue.sample.reminders").click();
    expect(hub.settings.get("endue.sample.reminders")).toBe(false);
    change(control(el, "desk.notify.history"), "75");
    expect(hub.settings.get("desk.notify.history")).toBe(75);
    hub.settings.set("desk.theme.scheme", "light");
    await preferences.settled();
    expect(data.preferences).toEqual({
      version: 1,
      values: {
        "desk.notify.history": 75,
        "desk.theme.scheme": "light",
        "endue.sample.reminders": false,
        "endue.sample.week-start": "monday",
      },
    });

    const reopened = await setup(data, init);
    expect(reopened.hub.settings.get("endue.sample.week-start")).toBe("monday");
    expect(reopened.hub.settings.get("endue.sample.reminders")).toBe(false);
    expect(reopened.hub.settings.get("desk.notify.history")).toBe(75);
    expect(reopened.hub.settings.get("desk.theme.scheme")).toBe("light");
    const again = shown(pluginSettings({ ...reopened, language: "en" }));
    expect(control<HTMLSelectElement>(again, "endue.sample.week-start").value).toBe("monday");
    const history = again.querySelector('[data-setting="desk.notify.history"]');
    const reset = history?.querySelector<HTMLButtonElement>("button");
    expect(reset?.textContent).toBe("Reset");
    reset?.click();
    // init.yaml's value shows through again, and the record forgets the person's.
    expect(reopened.hub.settings.get("desk.notify.history")).toBe(50);
    expect(control<HTMLInputElement>(again, "desk.notify.history").value).toBe("50");
    expect(reset?.hidden).toBe(true);
    await reopened.preferences.settled();
    expect(Object.keys((data.preferences as { values: object }).values)).not.toContain(
      "desk.notify.history",
    );
  });

  it("refuses values the declaration does not allow", async () => {
    const { hub, preferences, data } = await setup();
    const el = shown(pluginSettings({ hub, preferences, language: "en" }));
    const page = control<HTMLInputElement>(el, "endue.sample.page");
    for (const [key, value] of [
      ["endue.sample.page", "600"],
      ["endue.sample.page", "12.5"],
      ["endue.sample.zoom", "0.25"],
      ["endue.sample.signature", "<b>"],
    ] as const) {
      const input = control<HTMLInputElement>(el, key);
      change(input, value);
      expect(input.getAttribute("aria-invalid")).toBe("true");
    }
    expect(hub.settings.get("endue.sample.page")).toBe(50);
    expect(hub.settings.get("endue.sample.zoom")).toBe(1);
    expect(hub.settings.get("endue.sample.signature")).toBe("");
    await preferences.settled();
    expect(data.preferences).toBeUndefined();
    change(page, "100");
    expect(page.hasAttribute("aria-invalid")).toBe(false);
    expect(hub.settings.get("endue.sample.page")).toBe(100);
  });

  it("the window's search finds a plugin setting", async () => {
    const { hub, preferences } = await setup();
    const extra = declaredSearch(hub);
    for (const query of ["week start", "endue.sample.page", "reminder is due", "Sample"])
      expect(findSections(query, extra)).toContain("plugins");
    expect(findSections("week start")).not.toContain("plugins");
    const el = pluginSettings({ hub, preferences, language: "en", query: "week start" });
    expect(rows(el)).toEqual(["endue.sample.week-start"]);
    expect(
      rows(pluginSettings({ hub, preferences, language: "en", query: "sample" })),
    ).toHaveLength(5);
  });
});

describe("Settings, General", () => {
  it("General shows core settings no panel draws", async () => {
    const { hub, preferences } = await setup();
    // The live budget is the one the panels leave to these rows.
    const own = shown(coreSettings({ hub, preferences, language: "en" }));
    if (!own) throw new Error("no generated rows");
    expect(rows(own)).toEqual(["desk.surfaces.live"]);
    own.remove();
    const startAtLogin: SettingContribution = {
      kind: "boolean",
      default: false,
      description: "Open the desk to the tray when you log in.",
    };
    const declared = { ...CORE_SETTINGS, "desk.start-at-login": startAtLogin };
    const el = shown(coreSettings({ hub, preferences, language: "en" }, declared));
    if (!el) throw new Error("no generated rows");
    expect(rows(el)).toEqual(["desk.surfaces.live", "desk.start-at-login"]);
    const login = el.querySelector('[data-setting="desk.start-at-login"]');
    expect(login?.querySelector(".settings-row-label > span")?.textContent).toBe("Start at login");
    control<HTMLInputElement>(el, "desk.start-at-login").click();
    expect(hub.settings.get("desk.start-at-login")).toBe(true);
    expect(findSections("tray when you log in", declaredSearch(hub, declared))).toContain(
      "general",
    );
  });

  it("General sets desk.surfaces.live, the live budget: in force at once and kept across a restart", async () => {
    const { hub, preferences, data } = await setup();
    const el = shown(coreSettings({ hub, preferences, language: "en" }));
    if (!el) throw new Error("no generated rows");
    const field = control<HTMLInputElement>(el, "desk.surfaces.live");
    expect([field.type, field.min, field.step, field.value]).toEqual(["number", "0", "1", "8"]);
    expect(el.querySelector('[data-setting="desk.surfaces.live"] p')?.textContent).toContain(
      "out of sight keep a live frame",
    );
    // Fewer than none is refused.
    change(field, "-1");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(hub.settings.get("desk.surfaces.live")).toBe(8);
    change(field, "3");
    expect(hub.settings.get("desk.surfaces.live")).toBe(3);
    await preferences.settled();
    expect(data.preferences).toEqual({ version: 1, values: { "desk.surfaces.live": 3 } });

    const reopened = await setup(data);
    expect(reopened.hub.settings.get("desk.surfaces.live")).toBe(3);
    expect(findSections("live frame", declaredSearch(reopened.hub))).toContain("general");
  });
});
