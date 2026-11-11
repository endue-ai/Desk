// The buffer ring holds what shows something (#162 finding 13): a plugin's own surface is a stop
// only while the plugin holds no buffer of its own; while it does, the surface stands for the
// buffer it shows. Mod+W, Mod+B, next, previous and what shows after a close all follow that.
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { installBuffers } from "./buffers";
import type { DeskContext } from "./context";

const READER = "test.reader";
const NOTES = "test.notes";
const EXPLORER = "test.explorer";
const surface = (plugin: string) => `surface:${plugin}`;

/** desk.buffers with a palette that answers `answers` in turn and records what it was shown. */
async function desk(answers: Array<string | undefined> = []) {
  const manifests: PluginManifest[] = [{ id: "desk.buffers", kind: "policy", version: "0.1.0" }];
  const core = browserCore({ manifests });
  const hub = new PolicyHub(core.client);
  const shown: string[] = [];
  const request = vi.fn(async (_plugin: string, command: string, args?: unknown) => {
    if (command === "desk.buffers.show") shown.push((args as { buffer: string }).buffer);
    return null;
  });
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
  const policy = installBuffers(ctx, { focus: vi.fn() });
  const picks: Array<Array<{ id: string; label: string }>> = [];
  hub.commands.define("desk.palette.pick", {
    title: "Pick",
    owner: "desk",
    run: (args) => {
      picks.push((args as { items: Array<{ id: string; label: string }> }).items);
      return answers.shift();
    },
  });
  hub.apply(core.plugins);
  await hub.commands.settled();
  const list = policy.buffers;
  const file = (id: string, plugin: string) =>
    list.add({ id, name: id, plugin, path: `~/${id}`, modified: false, surface: false });
  const run = (id: string, args?: unknown) => hub.commands.run(id, args);
  return { policy, list, shown, picks, file, run, ctx };
}

/** A Reader that holds three files, whose own surface was used after its first file. */
async function reader() {
  const d = await desk();
  d.policy.surfaceOpened(READER, "Reader");
  d.file("empty.pdf", READER);
  d.list.touch("empty.pdf");
  // A walk with next stopped at the surface once, after the first file opened.
  d.list.touch(surface(READER));
  for (const id of ["manual.pdf", "novel.epub"]) {
    d.file(id, READER);
    d.list.touch(id);
  }
  return d;
}

describe("the buffer ring holds files, not a plugin's surface beside them", () => {
  it("Mod+W twice in a plugin with three files leaves the third showing", async () => {
    const d = await reader();
    await d.run("desk.buffers.close");
    expect(d.shown.at(-1)).toBe("manual.pdf");
    await d.run("desk.buffers.close");
    expect(d.shown.at(-1)).toBe("empty.pdf");
    expect(d.list.get("empty.pdf")).toBeDefined();
    // The next Mod+W closes the file the plugin shows, not nothing.
    await expect(d.run("desk.buffers.close")).resolves.toBe(true);
    expect(d.list.get("empty.pdf")).toBeUndefined();
    expect(d.ctx.unmount).not.toHaveBeenCalled();
  });

  it("Mod+W with the plugin's own surface in use closes the file it shows", async () => {
    const d = await reader();
    d.list.touch(surface(READER));
    await d.run("desk.buffers.close");
    expect(d.list.get("novel.epub")).toBeUndefined();
    expect(d.list.get(surface(READER))).toBeDefined();
    expect(d.shown.at(-1)).toBe("manual.pdf");
  });

  it("next and previous stop at every file and at a window without files, never at a surface beside its files", async () => {
    const d = await reader();
    d.policy.surfaceOpened(EXPLORER, "Explorer");
    const stops: unknown[] = [];
    for (let i = 0; i < 4; i += 1) stops.push(await d.run("desk.buffers.next"));
    // In a stable order (by plugin, then name), from the file in use, wrapping round.
    expect(stops).toEqual([surface(EXPLORER), "empty.pdf", "manual.pdf", "novel.epub"]);
    const back: unknown[] = [];
    for (let i = 0; i < 4; i += 1) back.push(await d.run("desk.buffers.previous"));
    expect(back).toEqual(["manual.pdf", "empty.pdf", surface(EXPLORER), "novel.epub"]);
  });

  it("Mod+B lists the files and the windows without files, and no row that shows nothing", async () => {
    const d = await reader();
    d.policy.surfaceOpened(EXPLORER, "Explorer");
    await d.run("desk.buffers.switch");
    expect(d.picks[0]?.map((item) => item.id)).toEqual([
      "novel.epub",
      "manual.pdf",
      "empty.pdf",
      surface(EXPLORER),
    ]);
  });

  it("switching to a plugin's own surface shows the file it holds, and the focus uses that file", async () => {
    const d = await reader();
    d.policy.surfaceOpened(NOTES, "Notes");
    d.file("a.md", NOTES);
    d.list.touch("a.md");
    await d.run("desk.buffers.switch", { id: surface(READER) });
    expect(d.shown.at(-1)).toBe("novel.epub");
    expect(d.list.current()?.id).toBe("novel.epub");
    d.policy.focused(NOTES);
    expect(d.list.current()?.id).toBe("a.md");
  });

  it("a plugin whose last file closed is a stop again, by its own surface", async () => {
    const d = await desk();
    d.policy.surfaceOpened(NOTES, "Notes");
    d.file("a.md", NOTES);
    d.list.touch("a.md");
    await d.run("desk.buffers.close");
    expect(d.list.current()?.id).toBe(surface(NOTES));
    await expect(d.run("desk.buffers.next")).resolves.toBe(surface(NOTES));
  });
});
