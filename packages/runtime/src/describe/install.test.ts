// @vitest-environment jsdom
import type { PluginManifest } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { CommandError } from "../commands";
import { PolicyHub } from "../hub";
import { ShortcutRouter } from "../input";
import type { DeskContext } from "../policies/context";
import { installKeys } from "../policies/keys";
import type { Description } from "./describe";
import { installDescribe } from "./install";

const policy = (id: string, contributes: PluginManifest["contributes"]): PluginManifest => ({
  id,
  name: id.split(".")[1],
  version: "0.1.0",
  kind: "policy",
  contributes,
});
const MANIFESTS = [
  policy("desk.keys", {
    keys: [
      { key: "Mod+S", command: "desk.files.save" },
      { key: "Mod+Shift+/", command: "desk.describe.open" },
    ],
    settings: { "desk.keys.bindings": { kind: "array", default: [] } },
  }),
  policy("desk.files", {}),
  policy("desk.theme", {
    settings: {
      "desk.theme.scheme": {
        kind: "string",
        default: "dark",
        choices: ["system", "light", "dark"],
      },
    },
  }),
];
const MANAGE = { permission: "perm:manage" } as const;

type Pick = { args: { title?: string; items: Array<{ id: string; label: string }> } };

/** The keys policy and desk.describe on the stub core, with a stand-in palette that records picks. */
async function desk(
  grants: Record<string, Array<{ permission: string; ids?: string[] }>> = {
    cli: [{ permission: "cmd:invoke", ids: ["*"] }],
  },
) {
  const core = browserCore({
    manifests: MANIFESTS,
    init: { settings: { "desk.theme.scheme": "light" }, file: "~/.desk/init.yaml" },
  });
  for (const info of core.plugins) info.folder = `/desk/plugins/${info.id.split(".")[1]}`;
  const bridge = core.client;
  for (const [caller, permissions] of Object.entries(grants))
    for (const permission of permissions)
      await bridge.call(
        "perm.request",
        { permission: permission as never, reason: "test" },
        { caller },
      );
  const hub = new PolicyHub(bridge);
  const root = document.createElement("div");
  document.body.append(root);
  const shortcuts = new ShortcutRouter({ platform: "mac" });
  const ctx = {
    hub,
    root,
    win: window,
    clock: new ManualClock(),
    bridge,
    shortcuts,
  } as unknown as DeskContext;
  const keys = installKeys(ctx);
  const picks: Array<Pick & { resolve(id: string): void; reject(e: unknown): void }> = [];
  const cancelled: string[] = [];
  hub.commands.define("desk.files.save", {
    title: "Save the file",
    owner: "desk.files",
    run: () => {},
  });
  hub.commands.define("desk.palette.pick", {
    title: "Pick one of many",
    owner: "desk",
    run: (args) =>
      new Promise((resolve, reject) => picks.push({ args: args as Pick["args"], resolve, reject })),
  });
  hub.commands.define("desk.palette.cancel", {
    title: "Close the palette",
    owner: "desk",
    run: () => {
      cancelled.push("cancel");
      picks.at(-1)?.reject(new CommandError("cancelled", "nothing was picked"));
    },
  });
  const described = installDescribe(ctx, { keys, profile: () => "default" });
  await hub.readInit(bridge);
  hub.apply((await bridge.call("plugin.list", { scope: { permission: "plugin:manage" } })).plugins);
  await hub.commands.settled();
  const dialog = () => root.querySelector<HTMLElement>(".desk-describe");
  const button = (name: string) =>
    [...(dialog()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === name);
  return { core, hub, root, shortcuts, picks, cancelled, dialog, button, described, keys };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("desk.describe.open", () => {
  it("desk.describe.open answers with show false and shows the surface otherwise", async () => {
    const { hub, dialog, button } = await desk();
    const answer = (await hub.commands.run("desk.describe.open", {
      kind: "setting",
      name: "desk.theme.scheme",
      show: false,
    })) as Description;
    expect(answer.kind).toBe("setting");
    expect(answer.summary).toBe('desk.theme.scheme is "light", set in init.yaml.');
    expect(answer.text).toContain("Layer: init.yaml, ~/.desk/init.yaml");
    expect(answer.file).toBe("~/.desk/init.yaml");
    expect(dialog()).toBeNull();

    await hub.commands.run("desk.describe.open", { kind: "key", name: "Mod+S" });
    expect(dialog()?.getAttribute("role")).toBe("dialog");
    expect(dialog()?.textContent).toContain("⌘S runs desk.files.save.");
    expect(dialog()?.textContent).toContain("Plugin: desk.files (files), /desk/plugins/files");
    expect(button("Open file")).toBeDefined();
    expect(button("Copy")).toBeDefined();
    button("Close")?.click();
    expect(dialog()).toBeNull();
  });

  it("the next key after desk.describe.open is described and the picker goes away", async () => {
    const { hub, shortcuts, picks, cancelled, dialog, keys } = await desk();
    expect(keys.keymap.keysFor("desk.describe.open")).toEqual(["⇧⌘/"]);
    await hub.commands.run("desk.describe.open", {});
    await vi.waitFor(() => expect(picks).toHaveLength(1));
    const ids = picks[0]?.args.items.map((item) => item.id) ?? [];
    expect(ids).toContain("command:desk.files.save");
    expect(ids).toContain("setting:desk.theme.scheme");
    expect(ids).toContain("plugin:desk.files");
    expect(ids.some((id) => id.startsWith("grant:"))).toBe(true);

    // What a frame forwards for Command+S while the picker has the focus.
    const key = { key: "s", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
    expect(shortcuts.handle(key)).toBe(true);
    await vi.waitFor(() => expect(dialog()?.textContent).toContain("⌘S runs desk.files.save."));
    expect(cancelled).toEqual(["cancel"]);

    // A pick is described instead when the person chooses one.
    await hub.commands.run("desk.describe.open", {});
    await vi.waitFor(() => expect(picks).toHaveLength(2));
    picks[1]?.resolve("setting:desk.theme.scheme");
    await vi.waitFor(() =>
      expect(dialog()?.textContent).toContain('desk.theme.scheme is "light", set in init.yaml.'),
    );
    // The chord is not awaited any more: Command+S saves again.
    expect(shortcuts.handle(key)).toBe(true);
    expect(dialog()?.textContent).toContain("desk.theme.scheme");
  });

  it("Open file reveals the file with shell.open and Copy copies the text", async () => {
    const { core, hub, button, dialog } = await desk();
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    await hub.commands.run("desk.describe.open", { kind: "setting", name: "desk.theme.scheme" });
    button("Open file")?.click();
    await vi.waitFor(() =>
      expect(core.opened()).toEqual([
        { caller: "desk", target: "~/.desk/init.yaml", reveal: true },
      ]),
    );
    button("Copy")?.click();
    await vi.waitFor(() => expect(dialog()?.textContent).toContain("Copied"));
    expect(written).toHaveLength(1);
    expect(written[0]?.split("\n")[0]).toBe('desk.theme.scheme is "light", set in init.yaml.');
  });

  it("grants are left out for a caller that may not list them", async () => {
    const { core } = await desk({
      "example.agent": [{ permission: "cmd:invoke", ids: ["desk.describe.*"] }],
      cli: [{ permission: "cmd:invoke", ids: ["*"] }, MANAGE],
    });
    const ask = async (caller: string) => {
      const { invocationId } = await core.client.call(
        "cmd.invoke",
        {
          id: "desk.describe.open",
          args: { kind: "command", name: "desk.files.save", show: false },
          scope: { permission: "cmd:invoke", ids: ["desk.describe.open"] },
        },
        { caller },
      );
      return new Promise<Description>((resolve, reject) => {
        const off = core.client.onEvent((event) => {
          if (event.event !== "cmd.answered" || event.data.invocationId !== invocationId) return;
          off();
          if (event.data.ok) resolve(event.data.result as Description);
          else reject(new Error(event.data.error?.message));
        });
      });
    };
    const agent = await ask("example.agent");
    expect(agent.text).toContain("grants are not shown to example.agent");
    expect(agent.text).not.toContain("cli");
    const cli = await ask("cli");
    expect(cli.text).toContain("with a cmd:invoke grant: cli");
  });
});
