import { describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { ShortcutRouter } from "../input";
import type { DeskContext } from "../policies/context";
import { installKeys } from "../policies/keys";
import { rebind } from "../rebind";
import { CORE_SETTINGS, PERSONAL_KEYS } from "./defaults";
import { Preferences, validPreferences } from "./preferences";

function setup(data: Record<string, unknown> = {}) {
  const core = browserCore({ manifests: [], store: memoryStore(data) });
  const hub = new PolicyHub(core.client);
  const preferences = new Preferences(hub.settings, core.client);
  return { core, hub, preferences, data };
}

describe("core preferences", () => {
  it("keeps wallpaper across restart and rejects unrecognized scenes", async () => {
    const { hub, preferences, data } = setup();
    await preferences.load();
    hub.settings.set("desk.wallpaper.scene", "pond");
    await preferences.settled();
    const reopened = setup(data);
    await reopened.preferences.load();
    expect(reopened.hub.settings.get("desk.wallpaper.scene")).toBe("pond");
    expect(validPreferences({ "desk.wallpaper.scene": "remote-script" })).toEqual({});
    preferences.dispose();
    reopened.preferences.dispose();
    hub.commands.dispose();
    reopened.hub.commands.dispose();
  });
  it("keeps and saves edits made before a slow initial read finishes", async () => {
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const data: Record<string, unknown> = {};
    const core = browserCore({
      manifests: [],
      store: memoryStore(data),
      handlers: {
        "store.get": async () => {
          await waiting;
          return { value: { version: 1, values: { "desk.theme.scheme": "dark" } } };
        },
      },
    });
    const hub = new PolicyHub(core.client);
    const preferences = new Preferences(hub.settings, core.client);
    const loading = preferences.load();
    hub.settings.set("desk.theme.scheme", "light");
    release();
    await loading;
    await preferences.settled();
    expect(hub.settings.get("desk.theme.scheme")).toBe("light");
    expect(data.preferences).toEqual({ version: 1, values: { "desk.theme.scheme": "light" } });
  });

  it("keeps typed settings without the theme or session plugins, and leaves bindings to keys.yaml", async () => {
    const { hub, preferences, data } = setup();
    const shortcuts = new ShortcutRouter({ platform: "mac" });
    const keys = installKeys({ hub, shortcuts } as DeskContext);
    hub.apply([]);
    await hub.commands.settled();
    expect(hub.commands.has("desk.keys.quit")).toBe(true);
    expect(keys.keymap.keysFor("desk.settings.open")).toEqual(["⌘,"]);
    expect(keys.keymap.keysFor("desk.buffers.close")).toEqual(["⌘W"]);
    expect(await hub.commands.run("desk.keys.list")).toContainEqual(
      expect.objectContaining({ command: "desk.settings.open" }),
    );
    await preferences.load();
    const personal = rebind(
      { contributed: keys.contributed(), personal: [], platform: "mac" },
      "desk.settings.open",
      "Mod+Shift+,",
    ).personal;
    hub.settings.set(PERSONAL_KEYS, personal);
    hub.settings.set("desk.theme.scheme", "light");
    await preferences.settled();
    expect(keys.keymap.keysFor("desk.settings.open")).toEqual(["⇧⌘,"]);
    // desk.keys keeps the person's bindings in ~/.desk/keys.yaml (ADR 0079), not in this record.
    expect(data.preferences).toEqual({ version: 1, values: { "desk.theme.scheme": "light" } });
    const reopened = setup(data);
    await reopened.preferences.load();
    expect(reopened.hub.settings.get(PERSONAL_KEYS)).toEqual([]);
    expect(reopened.hub.settings.get("desk.theme.scheme")).toBe("light");
    expect(preferences.state()).toBe("saved");
    keys.dispose();
    preferences.dispose();
    hub.commands.dispose();
    reopened.preferences.dispose();
    reopened.hub.commands.dispose();
  });

  it("leaves the session record's old bindings for keys.yaml to move", async () => {
    const session = { version: 1, parts: { keys: [{ key: "Mod+J", command: "desk.keys.list" }] } };
    const { hub, preferences, data } = setup({ session: structuredClone(session) });
    await preferences.load();
    await preferences.settled();
    expect(hub.settings.get(PERSONAL_KEYS)).toEqual([]);
    expect(data.session).toEqual(session);
    expect(data.preferences).toBeUndefined();
  });

  it("persists an edit or reset even if the effective value stays equal", async () => {
    const { hub, preferences, data } = setup();
    await preferences.load();
    hub.settings.setLayer("init", { "desk.theme.scheme": "light" });
    hub.settings.set("desk.theme.scheme", "light");
    await preferences.settled();
    expect(data.preferences).toEqual({ version: 1, values: { "desk.theme.scheme": "light" } });
    hub.settings.reset("desk.theme.scheme");
    await preferences.settled();
    expect(data.preferences).toEqual({ version: 1, values: {} });
  });

  it("rejects corrupt values and key bindings", () => {
    expect(
      validPreferences({
        "desk.theme.scheme": "purple",
        [PERSONAL_KEYS]: [{ key: "Mod+K", command: "desk.keys.list", mac: 10 }],
        "other.setting": true,
      }),
    ).toEqual({});
    expect(validPreferences({ "desk.notify.dnd": true, "desk.theme.motion": "reduce" })).toEqual({
      "desk.notify.dnd": true,
      "desk.theme.motion": "reduce",
    });
    expect(
      validPreferences({ [PERSONAL_KEYS]: [{ key: "Mod+J", command: "desk.keys.list" }] }),
    ).toEqual({});
    for (const value of [null, [], "bad", 12]) expect(validPreferences(value)).toEqual({});
  });

  it("reports a save failure and can retry the latest value", async () => {
    let fails = true;
    const core = browserCore({
      manifests: [],
      handlers: {
        "store.set": () => {
          if (fails) throw new Error("disk full");
          return {};
        },
      },
    });
    const hub = new PolicyHub(core.client);
    hub.settings.setDefaults(CORE_SETTINGS);
    const preferences = new Preferences(hub.settings, core.client);
    await preferences.load();
    hub.settings.set("desk.notify.dnd", true);
    await preferences.settled();
    expect(preferences.state()).toBe("error");
    fails = false;
    preferences.save();
    await preferences.settled();
    expect(preferences.state()).toBe("saved");
  });
});
