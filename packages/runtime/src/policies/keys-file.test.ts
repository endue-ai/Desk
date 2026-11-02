import type { KeyBinding, PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { checkKeysFile, readDeskYaml } from "../desk-yaml";
import { PolicyHub } from "../hub";
import { ShortcutRouter } from "../input";
import type { NoticeInput } from "../notify";
import type { DeskContext } from "./context";
import { installKeys, PERSONAL_KEYS } from "./keys";
import { installKeysFile, KEYS_FILE } from "./keys-file";

const MANAGE = { permission: "plugin:manage" } as const;

const keys: PluginManifest = {
  id: "desk.keys",
  version: "0.1.0",
  kind: "policy",
  contributes: { keys: [{ key: "Mod+K", command: "desk.palette.open" }] },
};

interface Start {
  files?: Record<string, string>;
  store?: Record<string, unknown>;
  init?: Record<string, unknown>;
}

/** desk.keys and its file on the stub core, with a desk folder in memory. */
async function desk({ files = {}, store = {}, init = {} }: Start = {}) {
  const core = browserCore({
    manifests: [keys],
    store: memoryStore(store),
    files,
    init: { settings: init },
  });
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  hub.apply((await bridge.call("plugin.list", { scope: MANAGE })).plugins);
  await hub.readInit(bridge);
  const notices: NoticeInput[] = [];
  const ctx = { hub, bridge, shortcuts: new ShortcutRouter({ platform: "other" }) };
  const policy = installKeys(ctx as unknown as DeskContext);
  const file = installKeysFile(ctx as unknown as DeskContext, (notice) => notices.push(notice));
  await file.start();
  const command = (combo: string) =>
    policy.keymap.bindings().find((binding) => binding.combo === combo)?.command;
  return { core, hub, policy, notices, store, command };
}

const bindingsIn = (text: string | undefined): KeyBinding[] => {
  const read = readDeskYaml("keys.yaml", text ?? "", checkKeysFile);
  if (!read.ok) throw new Error(read.problem);
  return read.value.bindings ?? [];
};

const J: KeyBinding = { key: "Mod+J", command: "desk.palette.open" };

describe("desk.keys keeps the person's bindings in ~/.desk/keys.yaml", () => {
  it("a rebinding writes ~/.desk/keys.yaml", async () => {
    const d = await desk();
    expect(d.core.folder.read(KEYS_FILE)).toBeUndefined();
    d.hub.settings.set(PERSONAL_KEYS, [J, { key: "Mod+K", command: "" }]);
    await vi.waitFor(() =>
      expect(bindingsIn(d.core.folder.read(KEYS_FILE))).toEqual([J, { key: "Mod+K", command: "" }]),
    );
  });

  it("keys.yaml is read at start as the person's layer", async () => {
    const d = await desk({
      files: { [KEYS_FILE]: "bindings:\n  - key: Mod+J\n    command: desk.palette.open\n" },
      init: { [PERSONAL_KEYS]: [{ key: "Mod+L", command: "desk.keys.list" }] },
    });
    expect(d.policy.personal()).toEqual([J]);
    d.hub.settings.setLayer("profile", {
      [PERSONAL_KEYS]: [{ key: "Mod+P", command: "desk.keys.list" }],
    });
    expect(d.policy.personal()).toEqual([J]);
    expect(d.command("Control+J")).toBe("desk.palette.open");
    expect(d.command("Control+L")).toBeUndefined();
    expect(d.command("Control+P")).toBeUndefined();
    expect(d.command("Control+K")).toBe("desk.palette.open");
  });

  it("a hand edit of keys.yaml rebinds without a restart", async () => {
    const d = await desk({ files: { [KEYS_FILE]: "bindings: []\n" } });
    expect(d.command("Control+J")).toBeUndefined();
    d.core.folder.write(
      KEYS_FILE,
      "# by hand\nbindings:\n  - key: Mod+J\n    command: desk.keys.list\n",
    );
    await vi.waitFor(() => expect(d.command("Control+J")).toBe("desk.keys.list"));
  });

  it("an invalid keys.yaml is ignored with a notice naming the line", async () => {
    const d = await desk({
      files: { [KEYS_FILE]: "bindings:\n  - key: Mod+J\n    command: desk.palette.open\n" },
    });
    const broken = "bindings:\n  - key: Mod+J\n    command: desk.palette.open\n  - key: Mod+L\n";
    d.core.folder.write(KEYS_FILE, broken);
    await vi.waitFor(() =>
      expect(d.notices.find((n) => n.title === "keys.yaml is not in force")).toMatchObject({
        level: "warning",
        body: expect.stringMatching(/^line 4: /),
      }),
    );
    expect(d.policy.personal()).toEqual([J]);

    // A rebinding while the file is broken stays in this session: the file is the person's to fix.
    d.hub.settings.set(PERSONAL_KEYS, [{ key: "Mod+L", command: "desk.keys.list" }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(d.core.folder.read(KEYS_FILE)).toBe(broken);
    expect(d.command("Control+L")).toBe("desk.keys.list");
  });

  it("bindings in the session record move to keys.yaml once", async () => {
    const store: Record<string, unknown> = {
      session: {
        version: 1,
        layout: {},
        files: [],
        focused: null,
        notices: [],
        parts: { keys: [J], shell: { desktop: 2 } },
      },
    };
    const first = await desk({ store });
    expect(bindingsIn(first.core.folder.read(KEYS_FILE))).toEqual([J]);
    expect(store.session).toMatchObject({ parts: { shell: { desktop: 2 } } });
    expect((store.session as { parts: Record<string, unknown> }).parts).not.toHaveProperty("keys");
    expect(first.policy.personal()).toEqual([J]);

    // A fresh desk folder with the same store: nothing is left to move.
    const second = await desk({ store });
    expect(second.core.folder.read(KEYS_FILE)).toBeUndefined();
    expect(second.policy.personal()).toEqual([]);
  });
});
