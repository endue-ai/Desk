// The desk puts a docs window nobody sees to sleep and loads it again when it shows (ADR 0070, ADR
// 0176): Docs answers ui.surface.state through the SDK's keepFiles with its documents, the one on
// screen, where the person was in each, the zoom they chose and the watches, and comes back to
// them; a document the desk lists that the frame lost opens again when it is shown, instead of
// "No document" (#162).
import { describe, expect, it, vi } from "vitest";
import { denied, disk, file, type Handlers, mount } from "./harness";
import { utf8 } from "./zip";

const A = file("~/Documents/a.rtf");
const B = file("~/Documents/b.rtf");
const DOCS = { permission: "fs:read", paths: ["~/Documents/**"] } as const;
const rtf = (text: string) => utf8(`{\\rtf1\\ansi ${text}\\par}`);
const FILES = () => ({ [A.path]: rtf("Alpha"), [B.path]: rtf("Beta") });

/** Docs with A and B open: the person left A on its third page, and is on B's second at 150 %. */
async function twoDocs(handlers: Handlers = disk(FILES())) {
  const first = await mount({ handlers });
  await first.host.command("desk.files.visit", A);
  first.view.here = { at: { page: 2, down: 0.5, across: 0 }, zoom: null };
  await first.host.command("desk.files.visit", B);
  first.view.here = { at: { page: 1, down: 0.25, across: 0.1 }, zoom: 1.5 };
  return first;
}

const asleep = async (mounted: Awaited<ReturnType<typeof mount>>) =>
  ((await mounted.host.surfaceState()) as { state: unknown }).state;

describe("put to sleep while hidden, and back", () => {
  it("answers ui.surface.state with its documents, the one on screen, the place in each and their watches", async () => {
    const first = await twoDocs();
    expect(await asleep(first)).toEqual({
      v: 1,
      files: [
        { ...A, place: { at: { page: 2, down: 0.5, across: 0 }, watchId: "w1" } },
        { ...B, place: { at: { page: 1, down: 0.25, across: 0.1 }, zoom: 1.5, watchId: "w2" } },
      ],
      shown: B.buffer,
    });
  });

  it("comes back to the document on screen, its place and zoom, without asking or taking the focus", async () => {
    const state = await asleep(await twoDocs());
    const second = await mount({ handlers: disk(FILES()), restored: state });
    await vi.waitFor(() =>
      expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer, name: "b.rtf" }),
    );
    expect(second.view.wheres.at(-1)).toEqual({
      at: { page: 1, down: 0.25, across: 0.1 },
      zoom: 1.5,
    });
    expect(second.view.focused).toBe(0);
    expect(second.params("perm.request")).toEqual([]);
    // Its watch from before the sleep still follows it: nothing is watched anew.
    expect(second.params("fs.watch")).toEqual([]);
    second.host.emit({
      event: "fs.changed",
      data: { watchId: "w2", path: B.path, change: "modified" },
    });
    await second.settle();
    expect(second.ran("desk.files.changed")).toEqual([{ path: B.path }]);
  });

  it("opens a kept document that was not on screen where it was, once it is shown", async () => {
    const state = await asleep(await twoDocs());
    const second = await mount({ handlers: disk(FILES()), restored: state });
    await vi.waitFor(() => expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer }));
    await expect(second.host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.rtf" });
    // Its place, not the zoom: the zoom is the view's, as the person left it.
    expect(second.view.wheres.at(-1)).toEqual({
      at: { page: 2, down: 0.5, across: 0 },
      zoom: null,
    });
    expect(second.view.focused).toBe(1);
    // Asleep again, both are kept.
    expect(((await asleep(second)) as { files: unknown[] }).files).toHaveLength(2);
  });

  it("a show of the document on screen while it opens again waits for it, and shows it there", async () => {
    const state = await asleep(await twoDocs());
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
    // The desk woke the window to show B, the document it had on screen, which is still opening.
    const show = second.host.command("desk.buffers.show", B);
    release();
    await expect(show).resolves.toBeUndefined();
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer, name: "b.rtf" });
    expect(second.view.wheres).toContainEqual({
      at: { page: 1, down: 0.25, across: 0.1 },
      zoom: 1.5,
    });
    expect(second.view.focused).toBe(1);
  });

  it("keeps the documents it has not opened again when it sleeps once more", async () => {
    const state = await asleep(await twoDocs());
    const second = await mount({ handlers: disk({}), restored: state });
    const again = (await asleep(second)) as { files: Array<{ path: string }> };
    expect(again.files.map((f) => f.path)).toEqual([A.path, B.path]);
  });

  it("forgets a kept document the desk closes", async () => {
    const state = await asleep(await twoDocs());
    const second = await mount({ handlers: disk(FILES()), restored: state });
    await second.host.command("desk.buffers.closed", A);
    await expect(second.host.command("desk.buffers.show", A)).rejects.toThrow(
      `No document ${A.buffer}.`,
    );
    const again = (await asleep(second)) as { files: Array<{ path: string }> };
    expect(again.files.map((f) => f.path)).toEqual([B.path]);
  });

  it("opens again on show and on revert a document the desk lists that its page lost (#162)", async () => {
    // A page that loaded again without a kept state holds nothing; the desk still lists A.
    const cold = await mount({ handlers: disk(FILES()) });
    await expect(cold.host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(cold.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.rtf" });
    expect(cold.view.focused).toBe(1);
    await expect(cold.host.command("desk.files.revert", B)).resolves.toBeUndefined();
    expect(cold.view.shown.at(-1)).toMatchObject({ buffer: B.buffer, name: "b.rtf" });
  });

  it("does not ask for a folder as it wakes; the person's show of the document does", async () => {
    const state = await asleep(await twoDocs());
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
      { permission: DOCS, reason: `To open ${B.path} in Docs` },
    ]);
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer });
    expect(second.view.wheres.at(-1)).toMatchObject({ zoom: 1.5 });
  });

  it("starts empty from a state it cannot read", async () => {
    const cold = await mount({ handlers: disk({}), restored: { docs: [] } });
    expect(cold.view.shown.at(-1)).toBeNull();
    expect(await asleep(cold)).toEqual({ v: 1, files: [], shown: null });
  });
});
