import type { PluginManifest, ProfileContribution } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { PolicyHub } from "../hub";
import type { DeskContext } from "./context";
import { installProfiles, OFF_KEY, PROFILES_KEY } from "./profiles";

const SHEETS = "example.sheets";
const NOTES = "example.notes";
const MANAGE = { permission: "plugin:manage" } as const;

const PROFILES: ProfileContribution[] = [
  { id: "plain", name: "Plain" },
  { id: "all", name: "All", plugins: { enabled: [SHEETS, NOTES] } },
  { id: "quiet", name: "Quiet", plugins: { disabled: [SHEETS, NOTES] } },
];

const ui = (id: string, autoload = false): PluginManifest => ({
  id,
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: id, placement: "center" }],
  ...(autoload ? { autoload: true } : {}),
});

/**
 * desk.profiles on the stub core, an autoload plugin (off at start) and a plain one; `off` off at
 * start too, `on` on (desk.files turned it on for a file, say).
 */
async function desk(off: string[], store: Record<string, unknown> = {}, on: string[] = []) {
  const core = browserCore({
    manifests: [
      {
        id: "desk.profiles",
        version: "0.1.0",
        kind: "policy",
        contributes: { profiles: PROFILES },
      },
      ui(SHEETS, true),
      ui(NOTES),
    ],
    off,
    store: memoryStore(store),
    init: { profile: "plain" },
  });
  for (const info of core.plugins) if (on.includes(info.id)) info.enabled = true;
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  const list = async () => hub.apply((await bridge.call("plugin.list", { scope: MANAGE })).plugins);
  await list();
  await hub.readInit(bridge);
  const profiles = installProfiles({ hub, bridge } as unknown as DeskContext, () => {});
  await hub.commands.settled();
  await profiles.start();
  const enabled = (id: string) => core.plugins.find((p) => p.id === id)?.enabled;
  const switchTo = async (id: string) => {
    await list();
    await hub.commands.run("desk.profiles.switch", { id });
  };
  return { core, hub, store, enabled, switchTo };
}

describe("desk.profiles leaves autoload plugins as they are", () => {
  it("switching to a profile that disables nothing leaves an off autoload plugin off", async () => {
    // An earlier switch turned both off (before the plugin was autoload, say).
    const d = await desk([SHEETS, NOTES], { [OFF_KEY]: [SHEETS, NOTES] });
    await d.switchTo("plain");
    expect(d.enabled(SHEETS)).toBe(false);
    expect(d.enabled(NOTES)).toBe(true);
    expect(d.store[OFF_KEY]).toEqual([]);
  });

  it("a profile that names an autoload plugin among its enabled ones leaves it off", async () => {
    const d = await desk([SHEETS, NOTES]);
    await d.switchTo("all");
    expect(d.enabled(SHEETS)).toBe(false);
    expect(d.enabled(NOTES)).toBe(true);
  });

  it("a profile that disables an autoload plugin that is on leaves it on", async () => {
    const d = await desk([], {}, [SHEETS]);
    expect(d.enabled(SHEETS)).toBe(true);
    await d.switchTo("quiet");
    expect(d.enabled(SHEETS)).toBe(true);
    expect(d.enabled(NOTES)).toBe(false);
    expect(d.store[OFF_KEY]).toEqual([NOTES]);
  });

  it("a saved profile does not list autoload plugins", async () => {
    const d = await desk([SHEETS]);
    await d.hub.commands.run("desk.profiles.save", { id: "mine", name: "Mine" });
    const [mine] = d.store[PROFILES_KEY] as ProfileContribution[];
    expect(mine?.plugins).toEqual({ enabled: ["desk.profiles", NOTES], disabled: [] });
  });
});
