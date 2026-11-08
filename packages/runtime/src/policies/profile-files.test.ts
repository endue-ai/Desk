import type { PluginManifest, ProfileContribution } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { checkProfileFile, readDeskYaml } from "../desk-yaml";
import { PolicyHub } from "../hub";
import type { NoticeInput } from "../notify";
import type { DeskContext } from "./context";
import { installProfiles, PROFILES_KEY } from "./profiles";

const MANAGE = { permission: "plugin:manage" } as const;
const DND = "desk.notify.dnd";
const dir = "~/.desk/profiles";

const CONTRIBUTED: ProfileContribution[] = [
  { id: "default", name: "Default" },
  { id: "focus", name: "Focus", settings: { [DND]: true } },
];

const policy: PluginManifest = {
  id: "desk.profiles",
  version: "0.1.0",
  kind: "policy",
  contributes: {
    profiles: CONTRIBUTED,
    settings: { [DND]: { kind: "boolean", default: false, description: "Do not disturb." } },
  },
};
const notes: PluginManifest = {
  id: "example.notes",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: "Notes", placement: "center" }],
};

interface Start {
  files?: Record<string, string>;
  store?: Record<string, unknown>;
  profile?: string;
}

/** desk.profiles on the stub core, with a desk folder in memory. */
async function desk({ files = {}, store = {}, profile = "default" }: Start = {}) {
  const core = browserCore({
    manifests: [policy, notes],
    store: memoryStore(store),
    files,
    init: { profile },
  });
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  hub.apply((await bridge.call("plugin.list", { scope: MANAGE })).plugins);
  await hub.readInit(bridge);
  const notices: NoticeInput[] = [];
  const profiles = installProfiles({ hub, bridge } as unknown as DeskContext, (notice) =>
    notices.push(notice),
  );
  await hub.commands.settled();
  await profiles.start();
  const file = (id: string) => core.folder.read(`${dir}/${id}.yaml`);
  return { core, hub, profiles, notices, store, file };
}

const parsed = (text: string | undefined) => {
  const read = readDeskYaml("profile", text ?? "", checkProfileFile);
  if (!read.ok) throw new Error(read.problem);
  return read.value;
};

describe("desk.profiles keeps the person's profiles as YAML files in the desk folder", () => {
  it("desk.profiles.save writes ~/.desk/profiles/<id>.yaml", async () => {
    const d = await desk();
    d.hub.settings.set(DND, true);
    await d.hub.commands.run("desk.profiles.save", { id: "writing", name: "Writing" });
    expect(parsed(d.file("writing"))).toEqual({
      name: "Writing",
      plugins: { enabled: ["desk.profiles", "example.notes"], disabled: [] },
      settings: { [DND]: true },
    });
    expect(d.store[PROFILES_KEY]).toBeUndefined();
  });

  it("a saved profile of a contributed id shadows it", async () => {
    const d = await desk();
    await d.hub.commands.run("desk.profiles.save", {
      id: "focus",
      name: "My focus",
      settings: { [DND]: false },
    });
    expect(parsed(d.file("focus")).name).toBe("My focus");
    const focus = d.profiles.list().filter((p) => p.id === "focus");
    expect(focus).toEqual([expect.objectContaining({ name: "My focus" })]);
  });

  it("a hand edit of the profile in force applies without a restart", async () => {
    const d = await desk({
      files: { [`${dir}/late.yaml`]: `name: Late\nsettings:\n  ${DND}: true\n` },
      profile: "late",
    });
    expect(d.profiles.active()).toBe("late");
    expect(d.hub.settings.get(DND)).toBe(true);
    d.core.folder.write(`${dir}/late.yaml`, `name: Late\nsettings:\n  ${DND}: false\n`);
    await vi.waitFor(() => expect(d.hub.settings.get(DND)).toBe(false));
    expect(d.profiles.list().find((p) => p.id === "late")?.settings).toEqual({ [DND]: false });

    // The runtime's own write is not read back as an edit.
    const before = d.notices.length;
    await d.hub.commands.run("desk.profiles.save", { id: "late", name: "Late" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(d.notices.slice(before).map((n) => n.title)).toEqual(["Saved profile Late"]);
  });

  it("an invalid profile file is ignored with a notice naming the line", async () => {
    const d = await desk({
      files: {
        [`${dir}/broken.yaml`]: "name: Broken\nsettings:\n  Desk.Theme: dark\n",
        [`${dir}/torn.yaml`]: "name: [Torn\n",
        [`${dir}/fine.yaml`]: "name: Fine\n",
      },
    });
    const ids = d.profiles.list().map((p) => p.id);
    expect(ids).toContain("fine");
    expect(ids).not.toContain("broken");
    expect(ids).not.toContain("torn");
    const broken = d.notices.find((n) => n.title === "profiles/broken.yaml is not in force");
    expect(broken).toMatchObject({ level: "warning", body: expect.stringMatching(/^line 3: /) });
    const torn = d.notices.find((n) => n.title === "profiles/torn.yaml is not in force");
    expect(torn?.body).toMatch(/^line \d+: /);
  });

  it("profiles in the store move to files once", async () => {
    const store: Record<string, unknown> = {
      [PROFILES_KEY]: [{ id: "mine", name: "Mine", settings: { [DND]: true } }],
    };
    const first = await desk({ store });
    expect(parsed(first.file("mine"))).toEqual({ name: "Mine", settings: { [DND]: true } });
    expect(store[PROFILES_KEY]).toBeNull();
    expect(first.profiles.list().map((p) => p.id)).toContain("mine");

    // The person deletes the file: the next start does not bring it back from the store.
    const second = await desk({ store });
    expect(second.file("mine")).toBeUndefined();
    expect(second.profiles.list().map((p) => p.id)).not.toContain("mine");
  });
});
