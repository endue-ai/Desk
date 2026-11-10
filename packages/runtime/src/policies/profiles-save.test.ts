/**
 * desk.profiles.save run by a caller other than the person (#102): the CLI or an agent over
 * desk.sock invokes the command, and the runtime writes the file as itself, under its own grant on
 * `~/.desk/profiles` (ADR 0079), as it does for the person. A save the core refuses changes nothing:
 * the profile is not listed, nothing switches to it, and the answer says why.
 */
import type { BridgeClient, CmdAnsweredData, PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { PolicyHub } from "../hub";
import type { NoticeInput } from "../notify";
import type { DeskContext } from "./context";
import { type DeskFolder, deskFolder } from "./desk-folder";
import { installProfiles } from "./profiles";

const MANAGE = { permission: "plugin:manage" } as const;
const DND = "desk.notify.dnd";

const policy: PluginManifest = {
  id: "desk.profiles",
  version: "0.1.0",
  kind: "policy",
  contributes: {
    profiles: [{ id: "plain", name: "Plain" }],
    settings: { [DND]: { kind: "boolean", default: false, description: "Do not disturb." } },
  },
};

/** desk.profiles on the stub core, `plain` in force; `folder` stands in for the desk folder. */
async function desk(folder?: (bridge: BridgeClient) => DeskFolder) {
  const core = browserCore({
    manifests: [policy],
    store: memoryStore(),
    init: { profile: "plain" },
  });
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  hub.apply((await bridge.call("plugin.list", { scope: MANAGE })).plugins);
  await hub.readInit(bridge);
  const notices: NoticeInput[] = [];
  const profiles = installProfiles(
    { hub, bridge } as unknown as DeskContext,
    (notice) => notices.push(notice),
    folder?.(bridge),
  );
  await hub.commands.settled();
  await profiles.start();
  /** Run a command as `cli`, the caller desk.sock's CLI connection calls as; its answer. */
  const asCli = async (id: string, args: Record<string, unknown>) => {
    const answers: CmdAnsweredData[] = [];
    const off = bridge.onEvent((event) => {
      if (event.event === "cmd.answered") answers.push(event.data);
    });
    const { invocationId } = await bridge.call(
      "cmd.invoke",
      { id, args, scope: { permission: "cmd:invoke", ids: [id] } },
      { caller: "cli" },
    );
    await expect.poll(() => answers.some((a) => a.invocationId === invocationId)).toBe(true);
    off();
    return answers.find((a) => a.invocationId === invocationId) as CmdAnsweredData;
  };
  const file = (id: string) => core.folder.read(`~/.desk/profiles/${id}.yaml`);
  return { core, hub, profiles, notices, asCli, file };
}

describe("desk.profiles.save over desk.sock (#102)", () => {
  it("saves a profile for the socket caller, as the person's save does, and puts it in force", async () => {
    const m = await desk();
    m.hub.settings.set(DND, true);
    const answer = await m.asCli("desk.profiles.save", { id: "quiet", name: "Quiet" });
    expect(answer).toMatchObject({ ok: true, caller: "cli", result: { id: "quiet" } });
    expect(m.file("quiet")).toContain("name: Quiet");
    expect(m.file("quiet")).toContain(`${DND}: true`);
    expect(m.profiles.active()).toBe("quiet");
    expect(m.profiles.saved()).toEqual(["quiet"]);
    expect(m.hub.settings.layer("profile")).toEqual({ [DND]: true });
    expect(m.notices.map((n) => n.title)).toContain("Saved profile Quiet");
  });

  it("the person's save writes the same file", async () => {
    const m = await desk();
    await m.hub.commands.run("desk.profiles.save", { id: "mine", name: "Mine" });
    expect(m.file("mine")).toContain("name: Mine");
    expect(m.profiles.active()).toBe("mine");
  });

  it("a save the core refuses changes nothing and says why", async () => {
    const refusing = (bridge: BridgeClient): DeskFolder => ({
      ...deskFolder(bridge),
      write: async () => {
        throw new Error("fs.write: permission_denied: no grant covers the scope");
      },
    });
    const m = await desk(refusing);
    m.hub.settings.set(DND, true);
    const before = {
      profile: m.hub.settings.layer("profile"),
      session: m.hub.settings.layer("session"),
    };
    const answer = await m.asCli("desk.profiles.save", { id: "quiet", name: "Quiet" });
    expect(answer.ok).toBe(false);
    expect(answer.error?.message).toMatch(
      /quiet was not saved: fs\.write: permission_denied: no grant covers the scope/,
    );
    expect(m.profiles.active()).toBe("plain");
    expect(m.profiles.list().map((p) => p.id)).toEqual(["plain"]);
    expect(m.profiles.saved()).toEqual([]);
    expect(m.hub.settings.layer("profile")).toEqual(before.profile);
    expect(m.hub.settings.layer("session")).toEqual(before.session);
    expect(m.notices.map((n) => n.title)).not.toContain("Saved profile Quiet");
    // Nothing to switch to: the profile was never saved.
    const switched = await m.asCli("desk.profiles.switch", { id: "quiet" });
    expect(switched).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/no profile quiet/) },
    });
    expect(m.profiles.active()).toBe("plain");
  });
});
