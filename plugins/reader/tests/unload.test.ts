// The desk puts a reader window nobody sees to sleep and loads it again when it shows (ADR 0070, ADR
// XXXX): the reader answers ui.surface.state through the SDK's keepFiles with its files, the one on
// screen and where the person was in each, and comes back to them; a file the desk lists that the
// frame lost opens again when it is shown, instead of "No file" (#162).
import { describe, expect, it, vi } from "vitest";
import { keyFor } from "../ui/marks.js";
import { cbz } from "./build/comics";
import { denied, disk, file, folderScope, mount } from "./harness";

const A = file("~/Comics/a.cbz");
const B = file("~/Comics/b.cbz");

/** A reader with A and B open, B on screen at its second page and 150 %. */
async function twoFiles(files: Record<string, Uint8Array>, store: Record<string, unknown> = {}) {
  const first = await mount({ handlers: disk(files, store) });
  await first.host.command("desk.files.visit", A);
  await first.host.command("desk.files.visit", B);
  first.app.moved({ unit: 1, offset: 0.25 });
  first.app.zoomed(1.5);
  await first.settle();
  return first;
}

const asleep = async (mounted: Awaited<ReturnType<typeof mount>>) =>
  ((await mounted.host.surfaceState()) as { state: unknown }).state;

describe("put to sleep while hidden, and back", () => {
  it("answers ui.surface.state with its files, the one on screen, the place in each and their watches", async () => {
    const first = await twoFiles({ [A.path]: cbz(), [B.path]: cbz() });
    expect(await asleep(first)).toEqual({
      v: 1,
      files: [
        { ...A, place: { at: { unit: 0, offset: 0 }, zoom: null, watchId: "w1" } },
        { ...B, place: { at: { unit: 1, offset: 0.25 }, zoom: 1.5, watchId: "w2" } },
      ],
      shown: B.buffer,
    });
  });

  it("comes back to the file on screen, its page and zoom, without asking or taking the focus", async () => {
    const files = { [A.path]: cbz(), [B.path]: cbz() };
    const store: Record<string, unknown> = {};
    const state = await asleep(await twoFiles(files, store));
    // The store's position lags a scroll; what the sleep kept wins.
    (store[keyFor(B.path)] as { offset: number }).offset = 0;

    const second = await mount({ handlers: disk(files, store), restored: state });
    await vi.waitFor(() =>
      expect(second.view.shown.at(-1)).toMatchObject({
        buffer: B.buffer,
        at: { unit: 1, offset: 0.25 },
        zoom: 1.5,
      }),
    );
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

  it("opens a kept file that was not on screen where it was, once it is shown", async () => {
    const files = { [A.path]: cbz(), [B.path]: cbz() };
    const first = await twoFiles(files);
    await first.host.command("desk.buffers.show", A);
    first.app.moved({ unit: 1, offset: 0.5 });
    await first.host.command("desk.buffers.show", B);
    const state = await asleep(first);

    const second = await mount({ handlers: disk(files), restored: state });
    await vi.waitFor(() => expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer }));
    await second.host.command("desk.buffers.show", A);
    expect(second.view.shown.at(-1)).toMatchObject({
      buffer: A.buffer,
      at: { unit: 1, offset: 0.5 },
    });
    expect(second.view.focused).toBe(1);
    // Asleep again, both are kept, A now from the frame and B still from the last sleep.
    expect(((await asleep(second)) as { files: unknown[] }).files).toHaveLength(2);
  });

  it("a show of the file on screen while it opens again waits for it, and shows it there", async () => {
    const files = { [A.path]: cbz(), [B.path]: cbz() };
    const state = await asleep(await twoFiles(files));
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const plain = disk(files);
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
    // The desk woke the window to show B, the file it had on screen, which is still opening.
    const show = second.host.command("desk.buffers.show", B);
    release();
    await expect(show).resolves.toBeUndefined();
    expect(second.view.shown.at(-1)).toMatchObject({
      buffer: B.buffer,
      at: { unit: 1, offset: 0.25 },
      zoom: 1.5,
    });
    expect(second.view.focused).toBe(1);
  });

  it("keeps the files it has not opened again when it sleeps once more", async () => {
    const files = { [A.path]: cbz(), [B.path]: cbz() };
    const state = (await asleep(await twoFiles(files))) as { files: Array<{ path: string }> };
    const second = await mount({ handlers: disk(files), restored: state });
    const again = (await asleep(second)) as typeof state;
    expect(again.files.map((f) => f.path)).toEqual([A.path, B.path]);
  });

  it("forgets a kept file the desk closes", async () => {
    const files = { [A.path]: cbz(), [B.path]: cbz() };
    const state = await asleep(await twoFiles(files));
    const second = await mount({ handlers: disk(files), restored: state });
    await second.host.command("desk.buffers.closed", A);
    await expect(second.host.command("desk.buffers.show", A)).rejects.toThrow(
      `No file ${A.buffer}.`,
    );
    const again = (await asleep(second)) as { files: Array<{ path: string }> };
    expect(again.files.map((f) => f.path)).toEqual([B.path]);
  });

  it("opens again on show a file the desk lists that its page lost (#162)", async () => {
    // A page that loaded again without a kept state holds nothing; the desk still lists A.
    const cold = await mount({ handlers: disk({ [A.path]: cbz() }) });
    await expect(cold.host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(cold.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.cbz" });
    expect(cold.view.focused).toBe(1);
    await expect(cold.host.command("desk.files.revert", A)).resolves.toBeUndefined();
  });

  it("does not ask for a folder as it wakes; the person's show of the file does", async () => {
    const files = { [A.path]: cbz(), [B.path]: cbz() };
    const state = await asleep(await twoFiles(files));
    let allowed = false;
    const plain = disk(files);
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
      { permission: folderScope(B.path), reason: `To open ${B.path} in Reader` },
    ]);
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer, zoom: 1.5 });
  });

  it("starts empty from a state it cannot read", async () => {
    const cold = await mount({ handlers: disk({}), restored: { notes: [] } });
    expect(cold.view.shown.at(-1)).toBeNull();
    expect(await asleep(cold)).toEqual({ v: 1, files: [], shown: null });
  });
});
