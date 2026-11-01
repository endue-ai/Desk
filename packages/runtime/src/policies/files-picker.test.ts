import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { installBuffers } from "./buffers";
import type { DeskContext } from "./context";
import { installFiles } from "./files";

async function desk(pickFile?: () => Promise<string | null>) {
  const manifests: PluginManifest[] = [
    { id: "desk.files", kind: "policy", version: "0.1.0" },
    { id: "desk.buffers", kind: "policy", version: "0.1.0" },
    {
      id: "test.notes",
      kind: "ui",
      version: "0.1.0",
      entry: "ui/index.html",
      contributes: { files: [{ pattern: "*.md", plugin: "test.notes" }] },
    },
  ];
  const core = browserCore({ manifests });
  const hub = new PolicyHub(core.client);
  const request = vi.fn(async (_plugin: string, _command: string, _args?: unknown) => null);
  const ctx = {
    hub,
    bridge: core.client,
    surfaces: { show: vi.fn() },
    request,
    mounted: () => true,
    whenReady: async () => {},
    unmount: vi.fn(),
  } as unknown as DeskContext;
  const buffers = installBuffers(ctx, { focus: vi.fn() });
  const notify = vi.fn();
  const files = installFiles(ctx, buffers, notify, pickFile);
  const palette = vi.fn(async () => "/from/palette.md");
  hub.commands.define("desk.palette.pick", { title: "Pick", owner: "desk", run: palette });
  hub.apply(core.plugins);
  await hub.commands.settled();
  return {
    run: (args?: unknown) => hub.commands.run("desk.files.open", args),
    palette,
    request,
    buffers,
    files,
    notify,
  };
}

describe("the host's native picker", () => {
  it("uses the picker for Open a file and visits the selected file through its opener", async () => {
    const picker = vi.fn(async () => "/chosen/notes.md");
    const d = await desk(picker);
    expect(await d.run()).toBe("file:/chosen/notes.md");
    expect(picker).toHaveBeenCalledOnce();
    expect(d.palette).not.toHaveBeenCalled();
    expect(d.request).toHaveBeenCalledWith("test.notes", "desk.files.visit", {
      buffer: "file:/chosen/notes.md",
      path: "/chosen/notes.md",
    });
    expect(d.files.recent()).toEqual([{ path: "/chosen/notes.md", plugin: "test.notes" }]);
  });

  it("cancelling is silent and never falls back to the path palette", async () => {
    const d = await desk(async () => null);
    expect(await d.run()).toBeNull();
    expect(d.palette).not.toHaveBeenCalled();
    expect(d.request).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.buffers.buffers.list()).toEqual([]);
  });

  it("explicit paths bypass the picker and reopening reuses the existing buffer", async () => {
    const picker = vi.fn(async () => null);
    const d = await desk(picker);
    await d.run({ path: "/chosen/notes.md" });
    await d.run({ path: "/chosen/notes.md" });
    expect(picker).not.toHaveBeenCalled();
    expect(d.buffers.buffers.list()).toHaveLength(1);
    expect(d.request.mock.calls.filter((call) => call[1] === "desk.files.visit")).toHaveLength(1);
  });

  it("retains the path palette for a host with no native picker", async () => {
    const d = await desk();
    expect(await d.run()).toBe("file:/from/palette.md");
    expect(d.palette).toHaveBeenCalledOnce();
  });
});
