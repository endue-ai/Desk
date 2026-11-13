import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { installBuffers } from "./buffers";
import type { DeskContext } from "./context";
import { installFiles } from "./files";
import { WINDOW_SETTING } from "./files-windows";

const IMAGES = "test.images";
const NOTES = "test.notes";
const file = (name: string) => `~/Pictures/${name}`;

const opener = (id: string, pattern: string, instances?: "per-file"): PluginManifest => ({
  id,
  kind: "ui",
  version: "0.1.0",
  entry: "ui/index.html",
  surfaces: [{ id: "main", placement: "center", ...(instances ? { instances } : {}) }],
  contributes: { files: [{ pattern, plugin: id }] },
});

/**
 * desk.files over a per-file image opener and a one-window notes opener, with a plugin host that
 * opens windows as the runtime's does: the first under the plugin id, then `<plugin>@<n>`.
 */
async function desk() {
  const core = browserCore({
    manifests: [
      { id: "desk.files", kind: "policy", version: "0.1.0" },
      { id: "desk.buffers", kind: "policy", version: "0.1.0" },
      opener(IMAGES, "*.png", "per-file"),
      opener(NOTES, "*.md"),
    ],
  });
  const hub = new PolicyHub(core.client);
  const windows = new Map<string, string[]>();
  let used = 1;
  /** What each window was asked, as `<window> <command> <buffer>`. */
  const asked: string[] = [];
  const request = vi.fn(async (key: string, command: string, args?: { buffer?: string }) => {
    asked.push(`${key} ${command} ${args?.buffer ?? ""}`);
    return null;
  });
  const unmount = vi.fn((key: string) => {
    for (const [plugin, keys] of windows) {
      const left = keys.filter((k) => k !== key);
      if (left.length > 0) windows.set(plugin, left);
      else windows.delete(plugin);
    }
  });
  const surfaces = { show: vi.fn() };
  const ctx = {
    hub,
    bridge: core.client,
    surfaces,
    request,
    mounted: (plugin: string) => windows.has(plugin),
    launch: async (plugin: string) => {
      if (!windows.has(plugin)) windows.set(plugin, [plugin]);
    },
    whenReady: async () => {},
    unmount,
    instances: (plugin: string) => windows.get(plugin) ?? [],
    another: (plugin: string) => {
      const key = `${plugin}@${++used}`;
      windows.set(plugin, [...(windows.get(plugin) ?? []), key]);
      return key;
    },
    inUse: (plugin: string) => windows.get(plugin)?.at(-1),
  } as unknown as DeskContext;
  const buffers = installBuffers(ctx, { focus: vi.fn() });
  installFiles(ctx, buffers, vi.fn());
  hub.apply(core.plugins);
  await hub.commands.settled();
  const open = (path: string) => hub.commands.run("desk.files.open", { path });
  const windowOf = (path: string) => {
    const buffer = buffers.buffers.byPath(path);
    return buffer?.instance ?? buffer?.plugin;
  };
  /** desk.files.open as the opener itself, as Images walking its folder. */
  const openAs = (caller: string, path: string) =>
    new Promise<void>((resolve) => {
      const off = core.client.onEvent((event) => {
        if (event.event === "cmd.answered" && event.data.caller === caller) {
          off();
          resolve();
        }
      });
      void core.client.call(
        "cmd.invoke",
        { id: "desk.files.open", args: { path }, scope: { permission: "cmd:invoke", ids: ["*"] } },
        { caller },
      );
    });
  return { hub, open, openAs, asked, windows, windowOf, buffers, unmount, surfaces };
}

describe("a per-file opener (ADR 0212)", () => {
  it("opens three images in three windows, each showing its own", async () => {
    const d = await desk();
    for (const name of ["a.png", "b.png", "c.png"]) await d.open(file(name));
    expect(d.windows.get(IMAGES)).toEqual([IMAGES, `${IMAGES}@2`, `${IMAGES}@3`]);
    expect(d.windowOf(file("a.png"))).toBe(IMAGES);
    expect(d.windowOf(file("b.png"))).toBe(`${IMAGES}@2`);
    expect(d.windowOf(file("c.png"))).toBe(`${IMAGES}@3`);
    expect(d.asked).toEqual([
      `${IMAGES} desk.files.visit file:${file("a.png")}`,
      `${IMAGES} desk.buffers.show file:${file("a.png")}`,
      `${IMAGES}@2 desk.files.visit file:${file("b.png")}`,
      `${IMAGES}@2 desk.buffers.show file:${file("b.png")}`,
      `${IMAGES}@3 desk.files.visit file:${file("c.png")}`,
      `${IMAGES}@3 desk.buffers.show file:${file("c.png")}`,
    ]);
  });

  it("opens images chosen together in a window each", async () => {
    const d = await desk();
    await Promise.all(["a.png", "b.png", "c.png"].map((name) => d.open(file(name))));
    const shown = ["a.png", "b.png", "c.png"].map((name) => d.windowOf(file(name)));
    expect(new Set(shown).size).toBe(3);
  });

  it("brings an open image's window forward instead of opening it again", async () => {
    const d = await desk();
    for (const name of ["a.png", "b.png"]) await d.open(file(name));
    d.asked.length = 0;
    d.surfaces.show.mockClear();
    await d.open(file("a.png"));
    expect(d.windows.get(IMAGES)).toHaveLength(2);
    expect(d.asked).toEqual([`${IMAGES} desk.buffers.show file:${file("a.png")}`]);
    expect(d.surfaces.show).toHaveBeenCalledWith(IMAGES, true);
  });

  it("reloads a file that changed on disk in its own window only", async () => {
    const d = await desk();
    for (const name of ["a.png", "b.png"]) await d.open(file(name));
    d.asked.length = 0;
    await d.hub.commands.run("desk.files.changed", { path: file("b.png") });
    expect(d.asked).toEqual([`${IMAGES}@2 desk.files.revert file:${file("b.png")}`]);
  });

  it("closes a file's window with the file, and leaves the plugin's last window", async () => {
    const d = await desk();
    for (const name of ["a.png", "b.png"]) await d.open(file(name));
    await d.hub.commands.run("desk.buffers.close", { id: `file:${file("b.png")}` });
    expect(d.unmount).toHaveBeenCalledWith(`${IMAGES}@2`);
    expect(d.windowOf(file("a.png"))).toBe(IMAGES);
    d.unmount.mockClear();
    await d.hub.commands.run("desk.buffers.close", { id: `file:${file("a.png")}` });
    expect(d.unmount).not.toHaveBeenCalled();
    // The window left holds no file: the next image opens in it.
    await d.open(file("c.png"));
    expect(d.windowOf(file("c.png"))).toBe(IMAGES);
  });

  it("takes only a closed window's own file with it", async () => {
    const d = await desk();
    for (const name of ["a.png", "b.png", "c.png"]) await d.open(file(name));
    // As the runtime's closeSurface tells desk.buffers when a window closes.
    d.unmount(`${IMAGES}@2`);
    d.buffers.surfaceClosed(`${IMAGES}@2`);
    expect(d.buffers.buffers.byPath(file("b.png"))).toBeUndefined();
    expect(d.windowOf(file("a.png"))).toBe(IMAGES);
    expect(d.windowOf(file("c.png"))).toBe(`${IMAGES}@3`);
  });

  it("keeps a file the opener opens itself in the window it was opened from", async () => {
    const d = await desk();
    for (const name of ["a.png", "b.png"]) await d.open(file(name));
    // Images walking its folder from its second window, the one in use.
    await d.openAs(IMAGES, file("c.png"));
    expect(d.windows.get(IMAGES)).toHaveLength(2);
    expect(d.windowOf(file("c.png"))).toBe(`${IMAGES}@2`);
  });

  it("opens every file in one window under desk.files.window: shared, and for other openers", async () => {
    const d = await desk();
    d.hub.settings.set(WINDOW_SETTING, "shared");
    for (const name of ["a.png", "b.png"]) await d.open(file(name));
    for (const name of ["a.md", "b.md"]) await d.open(`~/Notes/${name}`);
    expect(d.windows.get(IMAGES)).toEqual([IMAGES]);
    expect(d.windows.get(NOTES)).toEqual([NOTES]);
    expect(d.windowOf(file("b.png"))).toBe(IMAGES);
    expect(d.windowOf("~/Notes/b.md")).toBe(NOTES);
  });
});
