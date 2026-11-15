import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type PluginInfo,
  type PluginManifest,
  stubCommands,
} from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import fleet from "../../../plugins/fleet/plugin.json";
import today from "../../../plugins/today/plugin.json";
import { PolicyHub } from "./hub";
import { defineOpenPlugin } from "./plugins-open";

const installed = (manifest: PluginManifest, enabled = true): PluginInfo => ({
  id: manifest.id,
  status: "ready",
  enabled,
  builtIn: true,
  revision: 1,
  manifest,
});
const notify: PluginManifest = { id: "desk.notify", version: "0.1.0", kind: "policy" };
const git: PluginManifest = {
  id: "endue.git",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
};

/** desk.plugins.open on a stub core whose plugin list is `plugins`; desk.views and desk.universal answer. */
async function setup(plugins: PluginInfo[]) {
  const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
  const enabled: string[] = [];
  const stub = browserStub({
    ...registry.handlers,
    "plugin.list": () => ({ plugins }),
    "plugin.setEnabled": ({ plugin }: { plugin: string }) => {
      enabled.push(plugin);
      const info = plugins.find((p) => p.id === plugin) as PluginInfo;
      return { plugin: { ...info, enabled: true } };
    },
  });
  const client = new BridgeClient(stub);
  const hub = new PolicyHub(client);
  const opened: Array<{ id: string; args: unknown }> = [];
  for (const provider of ["desk.views", "desk.universal"]) {
    const id = `${provider}.open`;
    await client.call("cmd.register", { id, title: id }, { caller: provider });
  }
  client.onEvent((event) => {
    if (event.event !== "cmd.invoked") return;
    const { invocationId, id, args } = event.data;
    if (id !== "desk.views.open" && id !== "desk.universal.open") return;
    opened.push({ id, args });
    const caller = id.split(".").slice(0, 2).join(".");
    void client.call("cmd.answer", { invocationId, result: { shown: true } }, { caller });
  });
  const launched: Array<{ id: string; wait: boolean }> = [];
  const focused: string[] = [];
  /** The windows each running plugin has, as PluginHost numbers them (ADR 0212). */
  const windows = new Map<string, number>();
  defineOpenPlugin({
    commands: hub.commands,
    bridge: client,
    launch: async (id, wait) => {
      launched.push({ id, wait });
      windows.set(id, Math.max(1, windows.get(id) ?? 0));
    },
    focus: (id) => focused.push(id),
    another: async (id) => {
      const open = windows.get(id);
      if (open === undefined) return undefined;
      windows.set(id, open + 1);
      return `${id}@${open + 1}`;
    },
  });
  await hub.commands.settled();
  const open = (args: unknown) => hub.commands.run("desk.plugins.open", args);
  return { open, opened, launched, focused, enabled };
}

describe("desk.plugins.open", () => {
  it("opens a view plugin (desk.today) the way its own open command does, as the palette's Open today", async () => {
    const { open, opened, launched } = await setup([installed(today as PluginManifest)]);
    await open({ plugin: "desk.today" });
    expect(opened).toEqual([{ id: "desk.views.open", args: { id: "desk.today" } }]);
    expect(launched).toEqual([]);
  });

  it("opens a policy plugin with an open command (desk.fleet): its board", async () => {
    const { open, opened } = await setup([installed(fleet as PluginManifest)]);
    await open({ plugin: "desk.fleet" });
    expect(opened).toEqual([
      { id: "desk.universal.open", args: { view: expect.objectContaining({ id: "desk.fleet" }) } },
    ]);
  });

  it("turns a data-only plugin the person turned off on before opening it", async () => {
    const { open, opened, enabled } = await setup([installed(today as PluginManifest, false)]);
    await open({ plugin: "desk.today" });
    expect(enabled).toEqual(["desk.today"]);
    expect(opened).toHaveLength(1);
  });

  it("says a plugin with nothing to show has no window, instead of calling it not launchable", async () => {
    const { open, opened, launched, enabled } = await setup([installed(notify, false)]);
    await expect(open({ plugin: "desk.notify" })).rejects.toThrow(
      "desk.notify has no window to open",
    );
    expect({ opened, launched, enabled }).toEqual({ opened: [], launched: [], enabled: [] });
  });

  it("launches a UI plugin and gives it the focus, as before", async () => {
    const { open, launched, focused } = await setup([installed(git)]);
    await open({ plugin: "endue.git", waitForReady: true });
    expect(launched).toEqual([{ id: "endue.git", wait: true }]);
    expect(focused).toEqual(["endue.git"]);
  });

  it("opens an app that has many windows in one more, and its first as always (ADR 0226)", async () => {
    const many: PluginManifest = {
      ...git,
      id: "example.app",
      surfaces: [{ id: "main", placement: "center", instances: "many" }],
    };
    const { open, launched, focused } = await setup([installed(many)]);
    // Not running yet: its first window opens.
    expect(await open({ plugin: "example.app", another: true })).toBeUndefined();
    expect(launched).toEqual([{ id: "example.app", wait: false }]);
    expect(await open({ plugin: "example.app", another: true })).toEqual({
      window: "example.app@2",
    });
    expect(await open({ plugin: "example.app", another: true })).toEqual({
      window: "example.app@3",
    });
    expect(focused).toEqual(["example.app", "example.app@2", "example.app@3"]);
    expect(launched).toHaveLength(1);
  });

  it("refuses one more window of a plugin that has one, and says why", async () => {
    const { open, launched } = await setup([installed(git)]);
    await expect(open({ plugin: "endue.git", another: true })).rejects.toThrow(
      'endue.git opens in one window: its manifest\'s first surface does not say instances: "many"',
    );
    expect(launched).toEqual([]);
  });

  it("leaves a plugin it does not know to the launcher, which says so", async () => {
    const { open, launched } = await setup([]);
    await open({ plugin: "endue.gone" });
    expect(launched).toEqual([{ id: "endue.gone", wait: false }]);
    await expect(open({})).rejects.toThrow("Choose a plugin to open");
  });
});
