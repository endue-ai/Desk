import type { BridgeClient } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { PolicyHub } from "../hub";
import type { DeskContext } from "./context";
import { type DeskFolder, deskFolder } from "./desk-folder";
import { installProfiles } from "./profiles";

const MANAGE = { permission: "plugin:manage" } as const;

/** desk.profiles on the stub core with two contributed profiles, `plain` in force. */
async function desk(folder?: (bridge: BridgeClient) => DeskFolder) {
  const core = browserCore({
    manifests: [
      {
        id: "desk.profiles",
        version: "0.1.0",
        kind: "policy",
        contributes: {
          profiles: [
            { id: "plain", name: "Plain" },
            { id: "loud", name: "Loud" },
          ],
        },
      },
    ],
    store: memoryStore(),
    init: { profile: "plain" },
  });
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  hub.apply((await bridge.call("plugin.list", { scope: MANAGE })).plugins);
  await hub.readInit(bridge);
  const profiles = installProfiles(
    { hub, bridge } as unknown as DeskContext,
    () => {},
    folder?.(bridge),
  );
  await hub.commands.settled();
  await profiles.start();
  const run = (id: string, args?: unknown) => hub.commands.run(id, args);
  const path = (id: string) => `~/.desk/profiles/${id}.yaml`;
  const file = (id: string) => core.folder.read(path(id));
  /** The person edits the file by hand (or takes it back from the Trash). */
  const edit = (id: string, text: string) => core.folder.write(path(id), text);
  return { run, file, edit, profiles };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("desk.profiles.remove", () => {
  it("removes a saved profile from the list; save keeps its description", async () => {
    const m = await desk();
    const mine = {
      id: "mine",
      name: "Mine",
      description: "Only what I use.",
      plugins: {},
      settings: {},
    };
    await m.run("desk.profiles.save", mine);
    expect(m.profiles.list().find((p) => p.id === "mine")).toEqual(mine);
    expect(await m.file("mine")).toContain("Only what I use.");
    expect(m.profiles.active()).toBe("plain");

    expect(await m.run("desk.profiles.remove", { id: "mine" })).toEqual({ id: "mine" });
    expect(m.profiles.list().map((p) => p.id)).toEqual(["plain", "loud"]);
    // Its file goes to the Trash (#158), where the person can take it back.
    expect(m.file("mine")).toBeUndefined();
  });

  it("a file taken back from the Trash is that profile again", async () => {
    const m = await desk();
    await m.run("desk.profiles.save", { id: "mine", name: "Mine", plugins: {}, settings: {} });
    const text = m.file("mine") as string;
    await m.run("desk.profiles.remove", { id: "mine" });
    m.edit("mine", text);
    await settled();
    expect(m.profiles.list().map((p) => p.id)).toContain("mine");
  });

  it("where there is no Trash the file stays, not read again until it is edited", async () => {
    const keeping = (bridge: BridgeClient): DeskFolder => ({
      ...deskFolder(bridge),
      trash: async () => false,
    });
    const m = await desk(keeping);
    await m.run("desk.profiles.save", { id: "mine", name: "Mine", plugins: {}, settings: {} });
    await m.run("desk.profiles.remove", { id: "mine" });
    expect(m.file("mine")).toBeDefined();
    expect(m.profiles.list().map((p) => p.id)).toEqual(["plain", "loud"]);
    m.edit("mine", `${m.file("mine")}description: Back.\n`);
    await settled();
    expect(m.profiles.list().find((p) => p.id === "mine")?.description).toBe("Back.");
  });

  it("refuses a contributed profile, one nobody saved and the one in force", async () => {
    const m = await desk();
    await expect(m.run("desk.profiles.remove", { id: "loud" })).rejects.toThrow(
      /loud is not a saved profile/,
    );
    await expect(m.run("desk.profiles.remove", { id: "gone" })).rejects.toThrow(
      /gone is not a saved profile/,
    );
    await m.run("desk.profiles.save", { id: "mine", name: "Mine", plugins: {}, settings: {} });
    await m.run("desk.profiles.switch", { id: "mine" });
    await expect(m.run("desk.profiles.remove", { id: "mine" })).rejects.toThrow(/mine is in force/);
    expect(m.profiles.list().map((p) => p.id)).toContain("mine");
  });

  it("lists the saved profiles by id, a file over a contributed profile among them", async () => {
    const m = await desk();
    expect(m.profiles.saved()).toEqual([]);
    await m.run("desk.profiles.save", { id: "mine", name: "Mine", plugins: {}, settings: {} });
    await m.run("desk.profiles.save", { id: "loud", name: "Louder", plugins: {}, settings: {} });
    expect(m.profiles.saved()).toEqual(["mine", "loud"]);
  });

  it("removing a file over the contributed profile in force brings that profile back, in force", async () => {
    const m = await desk();
    await m.run("desk.profiles.save", { id: "plain", name: "Mine now", plugins: {}, settings: {} });
    expect(m.profiles.list().find((p) => p.id === "plain")?.name).toBe("Mine now");
    expect(m.profiles.active()).toBe("plain");

    expect(await m.run("desk.profiles.remove", { id: "plain" })).toEqual({ id: "plain" });
    expect(m.profiles.active()).toBe("plain");
    expect(m.profiles.list().find((p) => p.id === "plain")?.name).toBe("Plain");
    expect(m.profiles.saved()).toEqual([]);
  });
});
