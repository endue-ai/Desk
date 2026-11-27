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
const ERIS = "endue.eris";
const PLAYER = "endue.player";
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
      viewer(ERIS, "*.txt"),
      viewer(PLAYER, "*.m3u"),
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
  const runAs = (caller: string, id: string, args: Record<string, unknown>) =>
    new Promise<unknown>((resolve) => {
      const off = bridge.onEvent((event) => {
        if (event.event === "cmd.answered" && event.data.caller === caller) {
          off();
          resolve(event.data.ok ? (event.data.result ?? true) : false);
        }
      });
      void bridge.call(
        "cmd.invoke",
        {
          id,
          args,
          scope: { permission: "cmd:invoke", ids: [id] },
        },
        { caller },
      );
    });
  const openAs = async (caller: string, args: Record<string, unknown>) =>
    (await runAs(caller, "desk.files.open", args)) !== false;
  const coreChoice = (caller: string, args: Record<string, unknown>) =>
    core.stub.emit({
      event: "cmd.invoked",
      data: {
        invocationId: "test-file-choice",
        id: "desk.files.open",
        caller,
        args,
        fileOpenGranted: true,
      },
    });
  return { hub, openAs, coreChoice, held, heldAtVisit, runAs };
}

describe("opening a file the person chose", () => {
  it("gives the opener its folder before the visit, from the desk's own open", async () => {
    const d = await desk();
    await d.hub.commands.run("desk.files.open", { path: PATH });
    expect(d.heldAtVisit).toEqual([[FOLDER]]);
  });

  it.each(["endue.explorer", "agent:eris"])(
    "does the same for a core-verified selection from %s",
    async (caller) => {
      const d = await desk();
      d.coreChoice(caller, { path: PATH });
      await vi.waitFor(() => expect(d.heldAtVisit).toEqual([[FOLDER]]));
      expect(await d.held(IMAGES)).toEqual([FOLDER]);
    },
  );

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

describe("an open that grants nothing", () => {
  it("gives the opener nothing with grant: false, as an endue:// link's open asks (#310)", async () => {
    const d = await desk();
    await d.hub.commands.run("desk.files.open", { path: PATH, grant: false });
    expect(d.heldAtVisit).toEqual([[]]);
    expect(await d.held(IMAGES)).toEqual([]);
    // grant: true asks for nothing more than the person's own open gives.
    const own = await desk();
    await own.hub.commands.run("desk.files.open", { path: PATH, grant: true });
    expect(own.heldAtVisit).toEqual([[FOLDER]]);
  });

  it("cannot pass a path by invoking the open command from an unrelated plugin", async () => {
    const d = await desk();
    await expect(d.openAs("example.sneaky", { path: PATH })).resolves.toBe(true);
    expect(d.heldAtVisit).toEqual([[]]);
    expect(await d.held(IMAGES)).toEqual([]);
  });
});

describe("saving a personally opened buffer", () => {
  it("grants the opener write access to only the saved file", async () => {
    const d = await desk();
    const buffer = await d.hub.commands.run("desk.files.open", { path: PATH });
    await d.hub.commands.run("desk.files.save", { buffer });
    expect(await d.held(IMAGES)).toEqual([FOLDER, { permission: "fs:write", paths: [PATH] }]);
  });

  it("does not grant write access when an agent opened the buffer", async () => {
    const d = await desk();
    await d.openAs("agent:mira", { path: PATH });
    await d.hub.commands.run("desk.files.save", { buffer: `file:${PATH}` });
    expect(await d.held(IMAGES)).toEqual([]);
  });
});

describe("file choices made inside the desk", () => {
  it("gives Eris only the file the person picked from the open buffers", async () => {
    const d = await desk();
    const path = "~/Notes/entry.txt";
    // This fixture has a different opener so Eris holds no folder grant before attaching the file.
    const buffer = await d.hub.commands.run("desk.files.open", { path, plugin: OTHER });
    d.hub.commands.define("desk.palette.pick", {
      title: "Choose",
      owner: "desk",
      run: () => buffer,
    });
    await d.hub.commands.settled();
    expect(await d.runAs("test.other", "desk.files.attach", {})).toBe(false);
    expect(await d.runAs(ERIS, "desk.files.attach", {})).toEqual({ path, modified: false });
    expect(await d.held(ERIS)).toEqual([{ permission: "fs:read", paths: [path] }]);
  });

  it("covers only the local entries of the Player's personally opened playlist", async () => {
    const d = await desk();
    const path = "~/Playlists/morning.m3u";
    await d.openAs("agent:mira", { path });
    const buffer = `file:${path}`;
    const paths = [
      "~/Music/one.ogg",
      "~/Music/two.ogg",
      "/Music/late.ogg",
      "https://example.test/live",
      "~/Other/*.mp3",
    ];
    await d.runAs(PLAYER, "desk.files.playlist-entries", { buffer, paths });
    expect(await d.held(PLAYER)).toEqual([]);
    // A subsequent open from the desk records the person's choice even for the existing buffer.
    await d.hub.commands.run("desk.files.open", { path });
    expect(await d.runAs(PLAYER, "desk.files.playlist-entries", { buffer, paths })).toBe(true);
    expect(await d.held(PLAYER)).toEqual([
      folderRead(path),
      { permission: "fs:read", paths: ["~/Music/**", "/Music/**"] },
    ]);
  });
});

describe("who chose", () => {
  it("is the person for the desk's own opens and a plugin's with the desk's opener", () => {
    expect(personChose({}, undefined)).toBe(true);
    expect(personChose({}, IMAGES)).toBe(true);
    expect(personChose({ caller: "endue.explorer" }, undefined)).toBe(false);
    expect(personChose({ caller: "endue.explorer", fileOpenGranted: true }, undefined)).toBe(true);
    expect(personChose({ caller: "endue.explorer" }, IMAGES)).toBe(false);
    expect(personChose({ caller: "agent:eris" }, undefined)).toBe(false);
    expect(folderRead("~/a.md")).toEqual({ permission: "fs:read", paths: ["~/**"] });
  });
});
