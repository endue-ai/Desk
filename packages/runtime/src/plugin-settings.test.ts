// A plugin's setting the person sets in Settings › Plugins reaches the plugin (#570): its
// settings.get and settings.list answer the person's value, and a change or a Reset sends
// settings.changed to its owner, as the core's own settings.set does.
import {
  BridgeClient,
  type BridgeEvent,
  type BridgeRequest,
  browserStub,
  StubError,
} from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { pluginSettings } from "./plugin-settings";
import { Settings } from "./settings";

const CALENDAR = "endue.calendar";

function setup(kept: string[] = ["endue.calendar.view"]) {
  const core: Record<string, unknown> = { "endue.calendar/view": "day" };
  const stub = browserStub({
    "settings.get": ({ key, owner, scope }, caller) => {
      const whose = owner ?? caller;
      if (whose !== caller && !scope) throw new StubError("permission_denied", "needs a scope");
      const value = core[`${whose}/${key}`];
      return value === undefined ? {} : { value };
    },
    "settings.list": (_params, caller = "") => ({
      settings: Object.entries(core)
        .filter(([name]) => name.startsWith(`${caller}/`))
        .map(([name, value]) => ({ owner: caller, key: name.split("/")[1] ?? "", value })),
    }),
  });
  const settings = new Settings();
  const keys = new Set(kept);
  const bridge = pluginSettings(new BridgeClient(stub), {
    settings,
    pluginKeys: () => [...keys],
    owner: (key) => (key.startsWith(`${CALENDAR}.`) ? CALENDAR : undefined),
  });
  const heard: BridgeEvent[] = [];
  bridge.onEvent((event) => heard.push(event));
  const ask = (method: string, params: object, caller = CALENDAR) =>
    bridge.forward({ id: 1, method, params } as BridgeRequest, caller);
  return { settings, keys, bridge, heard, ask, core };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const changed = (heard: BridgeEvent[]) => heard.filter((e) => e.event === "settings.changed");

describe("a plugin's setting set in Settings › Plugins (#570)", () => {
  it("settings.get answers the value the person set", async () => {
    const { settings, ask } = setup();
    expect(await ask("settings.get", { key: "view" })).toEqual({
      id: 1,
      ok: true,
      result: { value: "day" },
    });
    settings.set("endue.calendar.view", "week");
    expect(await ask("settings.get", { key: "view" })).toEqual({
      id: 1,
      ok: true,
      result: { value: "week" },
    });
    expect(await ask("settings.get", { key: "other" })).toEqual({ id: 1, ok: true, result: {} });
  });

  it("another plugin's read with a settings:read scope sees it too, after the core's check", async () => {
    const { settings, ask } = setup();
    settings.set("endue.calendar.view", "week");
    const scope = { permission: "settings:read", keys: ["endue.calendar/*"] };
    const read = await ask("settings.get", { key: "view", owner: CALENDAR, scope }, "endue.today");
    expect(read).toMatchObject({ ok: true, result: { value: "week" } });
    const refused = await ask("settings.get", { key: "view", owner: CALENDAR }, "endue.today");
    expect(refused).toMatchObject({ ok: false, error: { code: "permission_denied" } });
  });

  it("settings.list lays the person's values over the core's", async () => {
    const { settings, ask } = setup();
    settings.set("endue.calendar.view", "month");
    expect(await ask("settings.list", {})).toEqual({
      id: 1,
      ok: true,
      result: { settings: [{ owner: CALENDAR, key: "view", value: "month" }] },
    });
  });

  it("setting a value sends settings.changed to its owner", async () => {
    const { settings, heard } = setup();
    settings.set("endue.calendar.view", "week");
    await settle();
    expect(changed(heard)).toEqual([
      {
        event: "settings.changed",
        data: { owner: CALENDAR, key: "view", value: "week" },
        to: [CALENDAR],
      },
    ]);
  });

  it("a Reset sends settings.changed with the value the core answers now", async () => {
    const { settings, heard } = setup();
    settings.set("endue.calendar.view", "week");
    settings.reset("endue.calendar.view");
    await settle();
    expect(changed(heard).map((e) => (e.data as { value: unknown }).value)).toEqual([
      "week",
      "day",
    ]);
  });

  it("a value the runtime set that the person did not is not laid over", async () => {
    const { settings, heard, ask } = setup([]);
    settings.set("endue.calendar.view", "week");
    await settle();
    expect(await ask("settings.get", { key: "view" })).toMatchObject({ result: { value: "day" } });
    expect(changed(heard)).toEqual([]);
  });
});
