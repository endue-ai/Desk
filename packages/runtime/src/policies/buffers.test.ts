// desk.buffers asks about unsaved changes wherever buffers go (#160, #162, #163): closing one
// (Mod+W), closing the window that shows it (the list's guard, `shell/windows.ts`) and quitting the
// desk (`apps/desk/src/quit.ts`) ask the same question, one buffer at a time.
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import type { Buffer } from "../buffers";
import { PolicyHub } from "../hub";
import { installBuffers } from "./buffers";
import type { DeskContext } from "./context";

const NOTES = "test.notes";
const SHEETS = "test.sheets";

interface Asked {
  title: string;
  items: Array<{ id: string; label: string }>;
}

/** desk.buffers with a palette whose picks answer `answers` in turn, and a save that records. */
async function desk(answers: Array<string | undefined>, options: { palette?: boolean } = {}) {
  const manifests: PluginManifest[] = [{ id: "desk.buffers", kind: "policy", version: "0.1.0" }];
  const core = browserCore({ manifests });
  const hub = new PolicyHub(core.client);
  const request = vi.fn(async (_plugin: string, _command: string, _args?: unknown) => null);
  // The plugins whose window is out of sight (in the drawer, on another desktop).
  const away = new Set<string>();
  const ctx = {
    hub,
    bridge: core.client,
    surfaces: { show: vi.fn() },
    request,
    mounted: () => true,
    launch: async () => {},
    whenReady: async () => {},
    unmount: vi.fn(),
  } as unknown as DeskContext;
  const focus = vi.fn();
  const policy = installBuffers(ctx, { focus, inSight: (plugin) => !away.has(plugin) });
  const asked: Asked[] = [];
  if (options.palette !== false) {
    hub.commands.define("desk.palette.pick", {
      title: "Pick",
      owner: "desk",
      run: (args) => {
        asked.push(args as Asked);
        return answers.shift();
      },
    });
  }
  const saved: string[] = [];
  hub.commands.define("desk.files.save", {
    title: "Save the file",
    owner: "desk",
    run: (args) => {
      const id = (args as { buffer: string }).buffer;
      saved.push(id);
      policy.buffers.update(id, { modified: false });
      return id;
    },
  });
  hub.apply(core.plugins);
  await hub.commands.settled();
  const add = (id: string, plugin: string, modified: boolean, surface = false): Buffer =>
    policy.buffers.add({ id, name: id, plugin, modified, surface });
  return { hub, ctx, policy, list: policy.buffers, request, asked, saved, add, away, focus };
}

const labels = (asked: Asked | undefined) => asked?.items.map((item) => item.label);

describe("closing the window that shows a buffer with unsaved changes", () => {
  it("asks what Mod+W asks, and Keep it open keeps the window", async () => {
    const d = await desk(["cancel"]);
    d.add("a.md", NOTES, true);
    await expect(d.list.mayGo("close", { plugins: [NOTES] })).resolves.toBe(false);
    expect(d.asked).toHaveLength(1);
    expect(d.asked[0]?.title).toBe("a.md has unsaved changes");
    expect(labels(d.asked[0])).toEqual([
      "Save, then close",
      "Close without saving",
      "Keep it open",
    ]);
    expect(d.list.get("a.md")?.modified).toBe(true);
  });

  it("saves first when the person says so, and lets it go without saving when they say that", async () => {
    const d = await desk(["save", "discard"]);
    d.add("a.md", NOTES, true);
    await expect(d.list.mayGo("close", { plugins: [NOTES] })).resolves.toBe(true);
    expect(d.saved).toEqual(["a.md"]);
    d.list.update("a.md", { modified: true });
    await expect(d.list.mayGo("close", { plugins: [NOTES] })).resolves.toBe(true);
    expect(d.saved).toEqual(["a.md"]);
  });

  it("asks nothing about other plugins' buffers, saved buffers, or with the setting off", async () => {
    const d = await desk([]);
    d.add("a.md", NOTES, false);
    d.add("b.csv", SHEETS, true);
    await expect(d.list.mayGo("close", { plugins: [NOTES] })).resolves.toBe(true);
    d.hub.settings.set("desk.buffers.confirm-unsaved", false);
    await expect(d.list.mayGo("close", { plugins: [SHEETS] })).resolves.toBe(true);
    expect(d.asked).toEqual([]);
  });

  it("keeps the buffers when the desk cannot ask (no palette)", async () => {
    const d = await desk([], { palette: false });
    d.add("a.md", NOTES, true);
    await expect(d.list.mayGo("close", { plugins: [NOTES] })).resolves.toBe(false);
  });
});

describe("quitting the desk with unsaved changes", () => {
  it("asks about each modified buffer in the quit's words, showing each one first", async () => {
    const d = await desk(["discard", "cancel"]);
    d.add("a.md", NOTES, true);
    d.add("b.csv", SHEETS, true);
    d.list.touch("b.csv");
    const asking = vi.fn();
    await expect(d.list.mayGo("quit", { asking })).resolves.toBe(false);
    expect(asking).toHaveBeenCalled();
    expect(d.asked.map((a) => a.title)).toEqual([
      "b.csv has unsaved changes",
      "a.md has unsaved changes",
    ]);
    expect(labels(d.asked[0])).toEqual(["Save, then quit", "Quit without saving", "Don't quit"]);
    // b.csv was in use; a.md was shown before the desk asked about it.
    expect(d.request).toHaveBeenCalledWith(NOTES, "desk.buffers.show", { buffer: "a.md" });
    expect(d.request).not.toHaveBeenCalledWith(SHEETS, "desk.buffers.show", expect.anything());
  });

  it("goes on at once with nothing unsaved, and when the desk cannot ask", async () => {
    const d = await desk([], { palette: false });
    const asking = vi.fn();
    d.add("a.md", NOTES, false);
    await expect(d.list.mayGo("quit", { asking })).resolves.toBe(true);
    d.list.update("a.md", { modified: true });
    await expect(d.list.mayGo("quit", { asking })).resolves.toBe(true);
    expect(asking).not.toHaveBeenCalled();
  });
});

describe("closing a plugin's own surface", () => {
  it("asks about the plugin's buffers that go with it", async () => {
    const d = await desk(["cancel"]);
    d.add(`surface:${NOTES}`, NOTES, false, true);
    d.add("a.md", NOTES, true);
    d.list.touch(`surface:${NOTES}`);
    // Named by its id: Mod+W with no id closes the file the surface shows (buffers-ring.test.ts).
    const close = d.hub.commands.run("desk.buffers.close", { id: `surface:${NOTES}` });
    await expect(close).resolves.toBe(false);
    expect(d.asked[0]?.title).toBe("a.md has unsaved changes");
    expect(d.ctx.unmount).not.toHaveBeenCalled();
  });
});

describe("after a close, the buffer used before it shows", () => {
  const STATUS = "test.status";
  const MAIL = "test.mail";
  const TERMINAL = "test.terminal";

  it("the last one used that is in sight: a window put in the drawer stays there (issue 163, finding 6)", async () => {
    const d = await desk([]);
    for (const plugin of [TERMINAL, STATUS, MAIL]) d.add(`surface:${plugin}`, plugin, false, true);
    // The Terminal, then Status were used; Status went to the drawer; Mail is in use.
    d.list.touch(`surface:${TERMINAL}`);
    d.list.touch(`surface:${STATUS}`);
    d.away.add(STATUS);
    d.list.touch(`surface:${MAIL}`);
    await expect(d.hub.commands.run("desk.buffers.close")).resolves.toBe(true);
    expect(d.ctx.unmount).toHaveBeenCalledWith(MAIL);
    expect(d.focus).toHaveBeenCalledTimes(1);
    expect(d.focus).toHaveBeenCalledWith(TERMINAL);
    expect(d.list.current()?.id).toBe(`surface:${TERMINAL}`);
  });

  it("a shell pane's buffer is in sight while it is a buffer, and nothing shows when none is", async () => {
    const d = await desk([]);
    for (const id of ["window-1/p2", STATUS, MAIL]) {
      d.add(`surface:${id}`, id, false, true);
      d.list.touch(`surface:${id}`);
    }
    d.away.add(STATUS);
    await d.hub.commands.run("desk.buffers.close");
    expect(d.focus).toHaveBeenLastCalledWith("window-1/p2");
    await d.hub.commands.run("desk.buffers.close");
    expect(d.focus).toHaveBeenCalledTimes(1);
  });
});
