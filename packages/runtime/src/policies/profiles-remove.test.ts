import type { ProfileContribution } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { PolicyHub } from "../hub";
import type { DeskContext } from "./context";
import { installProfiles, PROFILES_KEY } from "./profiles";

const MANAGE = { permission: "plugin:manage" } as const;

/** desk.profiles on the stub core with two contributed profiles, `plain` in force. */
async function desk() {
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
  const profiles = installProfiles({ hub, bridge } as unknown as DeskContext, () => {});
  await hub.commands.settled();
  await profiles.start();
  const run = (id: string, args?: unknown) => hub.commands.run(id, args);
  const stored = async () =>
    ((await bridge.call("store.get", { key: PROFILES_KEY })) as { value?: ProfileContribution[] })
      .value ?? [];
  return { run, stored, profiles };
}

describe("desk.profiles.remove", () => {
  it("removes a saved profile from the store and the list; save keeps its description", async () => {
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
    expect(await m.stored()).toEqual([mine]);
    expect(m.profiles.active()).toBe("plain");

    expect(await m.run("desk.profiles.remove", { id: "mine" })).toEqual({ id: "mine" });
    expect(m.profiles.list().map((p) => p.id)).toEqual(["plain", "loud"]);
    expect(await m.stored()).toEqual([]);
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
});
