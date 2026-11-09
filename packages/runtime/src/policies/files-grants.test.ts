// Opening a file the person chose never asks (ADR 0131): before its visit, desk.files gives the
// opener read access to the file's folder (perm.grant), the scope the openers ask for. An agent's open,
// or a plugin naming the plugin to open with, gets nothing, so the opener asks as before.
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { installBuffers } from "./buffers";
import type { DeskContext } from "./context";
import { folderRead, installFiles, personChose } from "./files";

const IMAGES = "test.images";
const OTHER = "test.other";
const PATH = "~/Pictures/trip 2026/beach.png";
const FOLDER = { permission: "fs:read", paths: ["~/Pictures/trip 2026/**"] };

const viewer = (id: string, pattern: string): PluginManifest => ({
  id,
  kind: "ui",
  version: "0.1.0",
  entry: "ui/index.html",
  contributes: { files: [{ pattern, plugin: id }] },
});

async function desk() {
  const core = browserCore({
    manifests: [
      { id: "desk.files", kind: "policy", version: "0.1.0" },
      { id: "desk.buffers", kind: "policy", version: "0.1.0" },
      viewer(IMAGES, "*.png"),
      viewer(OTHER, "*.dat"),
    ],
  });
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  /** A caller's grants, as the person's permissions view lists them (the stub's perm.query is empty). */
  const held = async (plugin: string) =>
    (
      await bridge.call("perm.list", { caller: plugin, scope: { permission: "perm:manage" } })
    ).grants.map((g) => g.grant.permission);
  /** What the opener held when it was asked to visit: its grants, as it would read them. */
  const heldAtVisit: unknown[] = [];
  const request = vi.fn(async (plugin: string, command: string) => {
    if (command === "desk.files.visit") {
      heldAtVisit.push(await held(plugin));
    }
    return null;
  });
  const ctx = {
    hub,
    bridge,
    surfaces: { show: vi.fn() },
    request,
    mounted: () => true,
    launch: async () => {},
    whenReady: async () => {},
    unmount: vi.fn(),
  } as unknown as DeskContext;
  installFiles(ctx, installBuffers(ctx, { focus: vi.fn() }), vi.fn());
  hub.apply(core.plugins);
  await hub.commands.settled();
  /** desk.files.open as `caller` (a plugin, an agent), through the registry as the core runs it. */
  const openAs = (caller: string, args: Record<string, unknown>) =>
    new Promise<unknown>((resolve) => {
      const off = bridge.onEvent((event) => {
        if (event.event === "cmd.answered" && event.data.caller === caller) {
          off();
          resolve(event.data.ok);
        }
      });
      void bridge.call(
        "cmd.invoke",
        {
          id: "desk.files.open",
          args,
          scope: { permission: "cmd:invoke", ids: ["desk.files.open"] },
        },
        { caller },
      );
    });
  return { hub, openAs, held, heldAtVisit };
}

describe("opening a file the person chose", () => {
  it("gives the opener its folder before the visit, from the desk's own open", async () => {
    const d = await desk();
    await d.hub.commands.run("desk.files.open", { path: PATH });
    expect(d.heldAtVisit).toEqual([[FOLDER]]);
  });

  it("does the same for a plugin acting on the person's click, such as Explorer", async () => {
    const d = await desk();
    await expect(d.openAs("endue.explorer", { path: PATH })).resolves.toBe(true);
    expect(await d.held(IMAGES)).toEqual([FOLDER]);
  });

  it("gives nothing for an agent's open, or for a plugin that names the plugin to open with", async () => {
    const d = await desk();
    await expect(d.openAs("agent:mira", { path: PATH })).resolves.toBe(true);
    expect(await d.held(IMAGES)).toEqual([]);
    await expect(
      d.openAs("example.sneaky", { path: "~/.ssh/id.dat", plugin: OTHER }),
    ).resolves.toBe(true);
    expect(await d.held(OTHER)).toEqual([]);
  });
});

describe("who chose", () => {
  it("is the person for the desk's own opens and a plugin's with the desk's opener", () => {
    expect(personChose({}, undefined)).toBe(true);
    expect(personChose({}, IMAGES)).toBe(true);
    expect(personChose({ caller: "endue.explorer" }, undefined)).toBe(true);
    expect(personChose({ caller: "endue.explorer" }, IMAGES)).toBe(false);
    expect(personChose({ caller: "agent:eris" }, undefined)).toBe(false);
    expect(folderRead("~/a.md")).toEqual({ permission: "fs:read", paths: ["~/**"] });
  });
});
