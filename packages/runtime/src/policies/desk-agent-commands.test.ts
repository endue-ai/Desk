// @vitest-environment jsdom
import type { BridgeClient, CmdAnsweredData, PluginManifest } from "@endue-ai/bridge";
import { afterEach, expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { PolicyHub } from "../hub";
import { centreDesk } from "../notify-centre/fixtures";
import type { DeskContext } from "./context";
import { installProfiles } from "./profiles";
import { installTheme } from "./theme";

afterEach(() => document.body.replaceChildren());

async function invoke(bridge: BridgeClient, id: string, args: Record<string, unknown> = {}) {
  const answers: CmdAnsweredData[] = [];
  const off = bridge.onEvent((event) => {
    if (event.event === "cmd.answered") answers.push(event.data);
  });
  try {
    const { invocationId } = await bridge.call(
      "cmd.invoke",
      { id, args, scope: { permission: "cmd:invoke", ids: [id] } },
      { caller: "agent:eris" },
    );
    await expect
      .poll(() => answers.some((answer) => answer.invocationId === invocationId))
      .toBe(true);
    const answer = answers.find((answer) => answer.invocationId === invocationId);
    if (!answer?.ok) throw new Error(answer?.error?.message);
    return answer.result;
  } finally {
    off();
  }
}

async function list(bridge: BridgeClient, namespace: string) {
  const { commands } = await bridge.call("cmd.list", {
    scope: { permission: "cmd:invoke", ids: [`desk.${namespace}.*`] },
  });
  return new Map(commands.map((command) => [command.id, command]));
}

it("lists installed themes, takes a known ID and applies explicit appearance choices", async () => {
  const manifests: PluginManifest[] = [
    { id: "desk.theme", version: "0.1.0", kind: "policy" },
    { id: "example.paper", name: "Paper", version: "1.0.0", kind: "theme", theme: {} },
  ];
  const core = browserCore({ manifests });
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  const root = document.createElement("div");
  document.body.append(root);
  hub.apply(core.plugins);
  const theme = installTheme({
    hub,
    root,
    win: window,
    clock: new ManualClock(),
    bridge,
    share() {},
  } as unknown as DeskContext);
  await hub.commands.settled();
  const registered = await list(bridge, "theme");
  expect(registered.get("desk.theme.list")).toMatchObject({ readOnly: true, agent: true });
  expect(await invoke(bridge, "desk.theme.list")).toMatchObject({
    active: "",
    themes: expect.arrayContaining([{ id: "example.paper", name: "Paper" }]),
  });
  await invoke(bridge, "desk.theme.use", { id: "example.paper" });
  expect(theme.active()).toBe("example.paper");
  await expect(invoke(bridge, "desk.theme.use", { id: "unknown.theme" })).rejects.toThrow();
  expect(theme.active()).toBe("example.paper");
  await invoke(bridge, "desk.theme.set", { scheme: "light", contrast: "high", motion: "reduce" });
  expect(theme.state()).toMatchObject({ scheme: "light", contrast: "high", reducedMotion: true });
  await expect(
    invoke(bridge, "desk.theme.set", { scheme: "dark", motion: "invalid" }),
  ).rejects.toThrow();
  expect(theme.state().scheme).toBe("light");
  theme.dispose();
  hub.commands.dispose();
});

it("sets DND idempotently, reads history without opening the UI, and dismisses by ID", async () => {
  const desk = await centreDesk();
  const bridge = desk.core.client;
  const registered = await list(bridge, "notify");
  expect(registered.get("desk.notify.history")).toMatchObject({ readOnly: true, agent: true });
  expect(registered.get("desk.notify.clear")).toMatchObject({ irreversible: true, agent: true });
  await invoke(bridge, "desk.notify.dnd", { on: true });
  await invoke(bridge, "desk.notify.dnd", { on: true });
  expect(desk.hub.settings.get("desk.notify.dnd")).toBe(true);
  await invoke(bridge, "desk.notify.dnd", { on: false });
  const current = desk.policy.notify({ caller: "desk", title: "First", level: "info" });
  const above = desk.policy.notify({ caller: "desk", title: "Second", level: "success" });
  expect(await invoke(bridge, "desk.notify.history")).toMatchObject([
    { id: above.id, title: "Second" },
    { id: current.id, title: "First" },
  ]);
  expect(desk.panel()).toBeNull();
  expect(desk.policy.notifications.unread()).toBe(2);
  await invoke(bridge, "desk.notify.dismiss", { id: above.id });
  expect(desk.policy.notifications.current()?.id).not.toBe(above.id);
  expect(desk.policy.notifications.history()).toHaveLength(2);
  desk.policy.dispose();
  desk.hub.commands.dispose();
});

it("lists and switches profiles and saves the current setup under a new ID", async () => {
  const core = browserCore({
    manifests: [
      {
        id: "desk.profiles",
        version: "0.1.0",
        kind: "policy",
        contributes: {
          profiles: [
            { id: "plain", name: "Plain" },
            { id: "work", name: "Work", settings: { "desk.notify.dnd": true } },
          ],
        },
      },
    ],
  });
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  hub.apply(core.plugins);
  const profiles = installProfiles({ hub, bridge } as DeskContext, () => {});
  await hub.commands.settled();
  const registered = await list(bridge, "profiles");
  expect(registered.get("desk.profiles.list")).toMatchObject({ readOnly: true, agent: true });
  expect(registered.get("desk.profiles.remove")).toMatchObject({ irreversible: true, agent: true });
  expect(await invoke(bridge, "desk.profiles.list")).toMatchObject({
    profiles: [
      { id: "plain", name: "Plain" },
      { id: "work", name: "Work" },
    ],
  });
  await invoke(bridge, "desk.profiles.switch", { id: "work" });
  expect(hub.settings.get("desk.notify.dnd")).toBe(true);
  expect(
    await invoke(bridge, "desk.profiles.save", { id: "focused", name: "Focused" }),
  ).toMatchObject({
    id: "focused",
    name: "Focused",
  });
  expect(profiles.active()).toBe("focused");
  expect(core.folder.read("~/.desk/profiles/focused.yaml")).toContain("name: Focused");
  await expect(
    invoke(bridge, "desk.profiles.save", { id: "focused", name: "Other" }),
  ).rejects.toThrow();
  expect(core.folder.read("~/.desk/profiles/focused.yaml")).toContain("name: Focused");
  const existing = "~/.desk/profiles/existing.yaml";
  core.folder.write(existing, "old profile text");
  await expect(
    invoke(bridge, "desk.profiles.save", { id: "existing", name: "Replacement" }),
  ).rejects.toThrow(/already exists/);
  expect(core.folder.read(existing)).toBe("old profile text");
  expect(Object.keys(core.folder.files()).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  await expect(
    invoke(bridge, "desk.profiles.save", { id: "injected", name: "Injected", settings: {} }),
  ).rejects.toThrow(/new profile ID and name/);
  profiles.dispose();
  hub.commands.dispose();
});
