// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountStatus, PluginManifest } from "@endue-ai/bridge";
import { afterEach, describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { invokeAsEris } from "./agent-tool-test";
import type { DeskContext } from "./context";
import { installCustomize } from "./customize";
import { CUSTOMIZE_KEY, LOCAL } from "./customize-store";

const policy = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../../plugins/customize/plugin.json"), "utf8"),
) as PluginManifest;
const notes: PluginManifest = {
  id: "endue.notes",
  name: "Notes",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
};
const palette: PluginManifest = { ...notes, id: "desk.palette", name: "Palette" };
const signedIn = (email: string): AccountStatus => ({ state: "signed-in", profile: { email } });

type Shared = { message: { type: string; custom?: unknown }; plugin?: string; drop?: boolean };
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

async function desk(stored: Record<string, unknown> = {}, safe = false) {
  const data: Record<string, unknown> = { ...stored };
  let status: AccountStatus = { state: "signed-out" };
  const core = browserCore({
    manifests: [policy, notes, palette],
    store: memoryStore(data),
    handlers: { "account.status": () => structuredClone(status) },
  });
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  hub.apply(core.plugins);
  const shared: Shared[] = [];
  const share = (message: Shared["message"], plugin?: string, drop?: boolean) =>
    shared.push({ message, plugin, drop });
  const asked: string[] = [];
  const request = async (plugin: string, command: string) => {
    asked.push(`${plugin} ${command}`);
    return "body\n  main#app";
  };
  const mounted = (plugin: string) => plugin === "endue.notes";
  const context = { hub, bridge, share, mounted, request } as unknown as DeskContext;
  const customize = installCustomize(context, safe);
  disposers.push(
    () => customize.dispose(),
    () => hub.commands.dispose(),
  );
  await customize.loaded;
  await hub.commands.settled();
  const account = async (next: AccountStatus) => {
    status = next;
    core.stub.emit({ event: "account.changed", data: next });
    await new Promise((done) => setTimeout(done, 10));
  };
  const last = (plugin: string) => shared.filter((s) => s.plugin === plugin).at(-1);
  return { data, hub, bridge, shared, last, account, asked };
}

const record = (sets: Record<string, Record<string, unknown>>) => ({
  [CUSTOMIZE_KEY]: { version: 1, sets },
});

describe("desk.customize (ADR 0398)", () => {
  it("sends this computer's kept changes to each plugin's windows at start", async () => {
    const { last } = await desk(
      record({ [LOCAL]: { "endue.notes": { css: "body { margin: 0 }", updated: "x" } } }),
    );
    expect(last("endue.notes")).toEqual({
      message: { type: "desk:custom", custom: { css: "body { margin: 0 }", js: undefined } },
      plugin: "endue.notes",
      drop: false,
    });
  });

  it("lets Eris change a plugin's style, keeps it, and undoes it to the style before", async () => {
    const { bridge, data, last } = await desk();
    const result = await invokeAsEris(bridge, "desk.customize.style", {
      plugin: "endue.notes",
      css: "textarea { font-size: 18px }",
      note: "bigger text",
    });
    expect(result).toEqual({ plugin: "endue.notes" });
    expect(last("endue.notes")?.message.custom).toEqual({
      css: "textarea { font-size: 18px }",
      js: undefined,
    });
    expect(data[CUSTOMIZE_KEY]).toMatchObject({
      sets: {
        [LOCAL]: { "endue.notes": { css: "textarea { font-size: 18px }", note: "bigger text" } },
      },
    });
    await invokeAsEris(bridge, "desk.customize.restore-style", { args: {}, result });
    expect(last("endue.notes")).toMatchObject({ message: { custom: {} }, drop: true });
    expect(await invokeAsEris(bridge, "desk.customize.list")).toMatchObject({ plugins: [] });
  });

  it("marks scripts irreversible, refuses one for the palette and a plugin that is not there", async () => {
    const { bridge, hub, asked } = await desk();
    const { commands } = await bridge.call("cmd.list", {
      scope: { permission: "cmd:invoke", ids: ["desk.customize.*"] },
    });
    const byId = new Map(commands.map((c) => [c.id, c]));
    expect(byId.get("desk.customize.script")).toMatchObject({ irreversible: true });
    expect(byId.get("desk.customize.style")?.irreversible).not.toBe(true);
    expect(byId.get("desk.customize.list")).toMatchObject({ readOnly: true });
    await expect(
      hub.commands.run("desk.customize.script", { plugin: "desk.palette", js: "1" }),
    ).rejects.toThrow(/no script/);
    await expect(
      invokeAsEris(bridge, "desk.customize.style", { plugin: "endue.nothing", css: "a{}" }),
    ).rejects.toThrow(/not an installed plugin/);
    await hub.commands.run("desk.customize.script", { plugin: "endue.notes", js: "go()" });
    expect(
      await invokeAsEris(bridge, "desk.customize.get", { plugin: "endue.notes" }),
    ).toMatchObject({
      plugin: "endue.notes",
      js: "go()",
      page: "ui/index.html",
      outline: "body\n  main#app",
    });
    expect(asked).toEqual(["endue.notes desk.customize.outline"]);
  });

  it("keeps a set per endue account and swaps it at sign-in and sign-out", async () => {
    const { bridge, data, last, account } = await desk();
    await invokeAsEris(bridge, "desk.customize.style", { plugin: "endue.notes", css: "a {}" });
    // The first sign-in takes this computer's set.
    await account(signedIn("Person@Example.com"));
    expect(last("endue.notes")?.message.custom).toEqual({ css: "a {}", js: undefined });
    await invokeAsEris(bridge, "desk.customize.style", { plugin: "endue.notes", css: "b {}" });
    const sets = (data[CUSTOMIZE_KEY] as { sets: Record<string, unknown> }).sets;
    const owners = Object.keys(sets);
    expect(owners).toHaveLength(2);
    expect(owners.join()).not.toContain("example");
    // Another account starts from this computer's set, not the first account's.
    await account(signedIn("other@example.com"));
    expect(last("endue.notes")?.message.custom).toEqual({ css: "a {}", js: undefined });
    await invokeAsEris(bridge, "desk.customize.clear", { plugin: "endue.notes" });
    expect(last("endue.notes")).toMatchObject({ drop: true });
    await account(signedIn("person@example.com"));
    expect(last("endue.notes")?.message.custom).toEqual({ css: "b {}", js: undefined });
    await account({ state: "signed-out" });
    expect(last("endue.notes")?.message.custom).toEqual({ css: "a {}", js: undefined });
  });

  it("sends nothing in safe mode or while desk.customize.enabled is off, and resumes after", async () => {
    const kept = record({ [LOCAL]: { "endue.notes": { css: "a {}", updated: "x" } } });
    expect((await desk(kept, true)).shared).toEqual([]);
    const { hub, last, shared } = await desk(kept);
    hub.settings.set("desk.customize.enabled", false);
    expect(last("endue.notes")).toMatchObject({ message: { custom: {} }, drop: true });
    hub.settings.set("desk.customize.enabled", true);
    expect(last("endue.notes")?.message.custom).toEqual({ css: "a {}", js: undefined });
    expect(shared).toHaveLength(3);
  });
});
