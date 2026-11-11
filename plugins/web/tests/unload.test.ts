// @vitest-environment jsdom
// The desk puts a web window nobody sees to sleep and loads it again when it shows (ADR 0070, ADR
// 0176): Web answers ui.surface.state through the SDK's keepFiles with its files, the one on screen,
// where the person was in each (how far down, the entry of an archive or a feed) and their watches,
// and comes back to them; a file the desk lists that the frame lost opens again when it is shown,
// instead of "No file" (#162).
import { describe, expect, it, vi } from "vitest";
import { createView } from "../ui/view.js";
import { denied, disk, file, folder, type Handlers, loadPage, mount } from "./harness";

const A = file("~/Sites/a.html");
const B = file("~/Sites/b.html");
const SITES = folder("~/Sites");
const page = (name: string) => `<!doctype html><title>${name}</title><p>${name}</p>`;
const FILES = () => ({ [A.path]: page("A"), [B.path]: page("B") });

/** Web with A and B open: the person left A a third down, and is half down B. */
async function twoFiles(handlers: Handlers = disk(FILES())) {
  const first = await mount({ handlers });
  await first.host.command("desk.files.visit", A);
  first.view.here = { down: 1 / 3 };
  await first.host.command("desk.files.visit", B);
  first.view.here = { down: 0.5, entry: 2 };
  return first;
}

const asleep = async (mounted: { host: { surfaceState(): Promise<unknown> } }) =>
  ((await mounted.host.surfaceState()) as { state: unknown }).state;

describe("put to sleep while hidden, and back", () => {
  it("answers ui.surface.state with its files, the one on screen, where the person was in each, and the watches", async () => {
    const first = await twoFiles();
    expect(await asleep(first)).toEqual({
      v: 1,
      files: [
        { ...A, place: { down: 1 / 3, watchId: "w1" } },
        { ...B, place: { down: 0.5, entry: 2, watchId: "w2" } },
      ],
      shown: B.buffer,
    });
  });

  it("comes back to the file on screen where it was, without asking or taking the focus", async () => {
    const state = await asleep(await twoFiles());
    const second = await mount({ handlers: disk(FILES()), restored: state });
    await vi.waitFor(() =>
      expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer, name: "b.html" }),
    );
    expect(second.view.wheres.at(-1)).toEqual({ down: 0.5, entry: 2 });
    expect(second.view.focused).toBe(0);
    expect(second.params("perm.request")).toEqual([]);
    expect(second.params("fs.watch")).toEqual([]);
    second.host.emit({
      event: "fs.changed",
      data: { watchId: "w2", path: B.path, change: "modified" },
    });
    await second.settle();
    expect(second.ran("desk.files.changed")).toEqual([{ path: B.path }]);
  });

  it("opens a kept file that was not on screen where it was, once it is shown", async () => {
    const state = await asleep(await twoFiles());
    const second = await mount({ handlers: disk(FILES()), restored: state });
    await vi.waitFor(() => expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer }));
    await expect(second.host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.html" });
    expect(second.view.wheres.at(-1)).toEqual({ down: 1 / 3 });
    expect(second.view.focused).toBe(1);
    expect(((await asleep(second)) as { files: unknown[] }).files).toHaveLength(2);
  });

  it("a file switched back to is where the person left it", async () => {
    const first = await twoFiles();
    await first.host.command("desk.buffers.show", A);
    expect(first.view.wheres.at(-1)).toEqual({ down: 1 / 3 });
    first.view.here = { down: 0.75 };
    await first.host.command("desk.buffers.show", B);
    expect(first.view.wheres.at(-1)).toEqual({ down: 0.5, entry: 2 });
    // The same file shown again stays where it is.
    await first.host.command("desk.buffers.show", B);
    expect(first.view.wheres.at(-1)).toBeUndefined();
  });

  it("a show of the file on screen while it opens again waits for it", async () => {
    const state = await asleep(await twoFiles());
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const plain = disk(FILES());
    const read = plain["fs.read"];
    if (!read) throw new Error("the disk reads");
    const second = await mount({
      handlers: {
        ...plain,
        "fs.read": async (params, caller) => {
          await gate;
          return read(params, caller);
        },
      },
      restored: state,
      settled: false,
    });
    const show = second.host.command("desk.buffers.show", B);
    release();
    await expect(show).resolves.toBeUndefined();
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer });
    expect(second.view.wheres).toContainEqual({ down: 0.5, entry: 2 });
    expect(second.view.focused).toBe(1);
  });

  it("keeps the files it has not opened again when it sleeps once more, and forgets one closed", async () => {
    const state = await asleep(await twoFiles());
    const second = await mount({ handlers: disk({}), restored: state });
    const again = (await asleep(second)) as { files: Array<{ path: string }> };
    expect(again.files.map((f) => f.path)).toEqual([A.path, B.path]);
    await second.host.command("desk.buffers.closed", A);
    await expect(second.host.command("desk.buffers.show", A)).rejects.toThrow(
      `No file ${A.buffer}.`,
    );
    const after = (await asleep(second)) as { files: Array<{ path: string }> };
    expect(after.files.map((f) => f.path)).toEqual([B.path]);
  });

  it("opens again on show and on revert a file the desk lists that its page lost (#162)", async () => {
    const cold = await mount({ handlers: disk(FILES()) });
    await expect(cold.host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(cold.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.html" });
    expect(cold.view.focused).toBe(1);
    await expect(cold.host.command("desk.files.revert", B)).resolves.toBeUndefined();
    expect(cold.view.shown.at(-1)).toMatchObject({ buffer: B.buffer, name: "b.html" });
  });

  it("does not ask for a folder as it wakes; the person's show of the file does", async () => {
    const state = await asleep(await twoFiles());
    let allowed = false;
    const plain = disk(FILES());
    const read = plain["fs.read"];
    if (!read) throw new Error("the disk reads");
    const second = await mount({
      handlers: {
        ...plain,
        "fs.read": (params, caller) => {
          if (!allowed) throw denied(`fs:read over ${params.path}`);
          return read(params, caller);
        },
        "perm.request": ({ permission }) => {
          allowed = true;
          return {
            granted: true,
            grant: {
              grantId: "g1",
              permission,
              duration: "session",
              grantedAt: "2026-11-12T00:00:00Z",
            },
          };
        },
      },
      restored: state,
    });
    await vi.waitFor(() =>
      expect(second.view.statuses.at(-1)).toBe(`Not allowed to read ${B.path}.`),
    );
    expect(second.params("perm.request")).toEqual([]);
    await second.host.command("desk.buffers.show", B);
    expect(second.params("perm.request")).toEqual([
      { permission: SITES, reason: `To open ${B.path} in Web` },
    ]);
    expect(second.view.wheres.at(-1)).toEqual({ down: 0.5, entry: 2 });
  });

  it("starts empty from a state it cannot read", async () => {
    const cold = await mount({ handlers: disk({}), restored: { pages: [] } });
    expect(cold.view.shown.at(-1)).toBeNull();
    expect(await asleep(cold)).toEqual({ v: 1, files: [], shown: null });
  });
});

describe("the page view's place", () => {
  it("reads how far down the page is, and a sleep's place puts it back there", async () => {
    loadPage(document);
    const host = document.getElementById("page") as HTMLElement;
    Object.defineProperty(host, "scrollHeight", { configurable: true, value: 2000 });
    const first = await mount({
      handlers: disk(FILES()),
      view: (actions) => createView(document, actions),
    });
    expect(first.view.where()).toBeNull();
    await first.host.command("desk.files.visit", A);
    host.scrollTop = 500;
    expect(first.view.where()).toEqual({ down: 0.25 });
    const state = await asleep(first);
    expect(state).toMatchObject({ files: [{ ...A, place: { down: 0.25 } }] });

    loadPage(document);
    const again = document.getElementById("page") as HTMLElement;
    Object.defineProperty(again, "scrollHeight", { configurable: true, value: 2000 });
    const second = await mount({
      handlers: disk(FILES()),
      view: (actions) => createView(document, actions),
      restored: state,
    });
    await vi.waitFor(() => expect(again.scrollTop).toBe(500));
    expect(second.view.where()).toEqual({ down: 0.25 });
  });
});
