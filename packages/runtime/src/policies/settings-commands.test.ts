// @vitest-environment jsdom
import { expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { createRuntime } from "../runtime";

async function desk() {
  const root = document.createElement("div");
  const core = browserCore({ manifests: [] });
  const runtime = createRuntime({ root, bridge: core.client, clock: new ManualClock() });
  await runtime.ready;
  return runtime;
}

it("answers declared settings with their defaults and winning layers", async () => {
  const hub = await desk();
  hub.settings.setLayer("init", { "desk.notify.dnd": true, "desk.theme.scheme": "light" });
  hub.settings.setLayer("profile", {
    "desk.theme.scheme": "system",
    "desk.theme.motion": "reduce",
  });
  hub.settings.setLayer("session", { "desk.theme.scheme": "light", "desk.theme.motion": 4 });
  await hub.commands.settled();

  expect(await hub.commands.run("desk.settings.get", { key: "desk.theme.scheme" })).toEqual({
    key: "desk.theme.scheme",
    value: "light",
    default: "dark",
    layer: "session",
  });
  expect(await hub.commands.run("desk.settings.get", { prefix: "desk.theme." })).toEqual([
    { key: "desk.theme.contrast", value: "system", default: "system", layer: "default" },
    { key: "desk.theme.motion", value: "reduce", default: "system", layer: "profile" },
    { key: "desk.theme.scheme", value: "light", default: "dark", layer: "session" },
  ]);
  expect(await hub.commands.run("desk.settings.get", { key: "desk.notify.dnd" })).toMatchObject({
    value: true,
    layer: "init",
  });
  await expect(hub.commands.run("desk.settings.get", { key: "unknown.value" })).rejects.toThrow(
    /declared/,
  );
  hub.dispose();
});

it("writes only declared, editable values that meet their whole schema", async () => {
  const hub = await desk();
  hub.settings.setDefaults({
    "desk.notify.info-ms": { kind: "integer", default: 1000, minimum: 0, maximum: 5000 },
    "example.theme.name": { kind: "string", default: "base", pattern: "^[a-z]+$" },
    "desk.theme.scheme": { kind: "string", default: "dark", choices: ["dark", "light"] },
    "desk.market.indexes": { kind: "array", default: [] },
    "desk.theme.markets": { kind: "array", default: [] },
    "desk.roles": { kind: "object", default: {} },
    "desk.keys.bindings": { kind: "array", default: [] },
    "endue.terminal.env": { kind: "object", default: {} },
  });
  hub.settings.setLayer("init", { "endue.terminal.env": { EXAMPLE: "env fixture" } });
  await hub.commands.settled();
  const set = (key: string, value: unknown) =>
    hub.commands.run("desk.settings.set", { key, value });

  for (const [key, value] of [
    ["desk.theme.scheme", "pink"],
    ["desk.notify.info-ms", 1.5],
    ["desk.notify.info-ms", -1],
    ["desk.notify.info-ms", 5001],
    ["example.theme.name", "Bad42"],
    ["desk.market.indexes", []],
    ["desk.theme.markets", []],
    ["desk.roles", {}],
    ["desk.keys.bindings", []],
    ["undeclared.key", 3],
  ] as const) {
    await expect(set(key, value)).rejects.toThrow();
    expect(Object.hasOwn(hub.settings.layer("session"), key)).toBe(false);
  }
  expect(await set("desk.notify.info-ms", 2500)).toEqual({
    key: "desk.notify.info-ms",
    value: 2500,
    default: 1000,
    layer: "session",
  });
  await hub.preferences.settled();
  const saved = await hub.preferences.bridge.call("store.get", { key: "preferences" });
  expect(saved.value).toMatchObject({ values: { "desk.notify.info-ms": 2500 } });
  await expect(
    hub.commands.run("desk.settings.get", { key: "endue.terminal.env" }),
  ).rejects.toThrow();
  expect(await hub.commands.run("desk.settings.get", { prefix: "endue.terminal." })).toEqual([]);
  hub.dispose();
});
