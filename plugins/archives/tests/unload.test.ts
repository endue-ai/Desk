// The desk puts an archives window nobody sees to sleep and loads it again when it shows (ADR 0070,
// ADR 0176): Archives answers ui.surface.state through the SDK's keepFiles with its archives, the
// one on screen, the levels opened in each, their open folders, selection and marks, the row at the
// top, the sort and filter and the watch, and comes back to them; an archive the desk lists that the
// frame lost opens again when it is shown, instead of "No archive" (#162 finding 1).
import { describe, expect, it, vi } from "vitest";
import { zipOf } from "./fixtures";
import { file, mount, READ, rowNames } from "./harness";

const DOWNLOADS = READ("~/Downloads");
const A = file("~/Downloads/a.zip");
const B = file("~/Downloads/b.zip");
const INNER = zipOf([
  { name: "deep/inner.txt", data: "inner\n" },
  { name: "x.txt", data: "x" },
]);
const FILES = () => ({
  [A.path]: zipOf([
    { name: "docs/one.md", data: "# One\n" },
    { name: "docs/two.md", data: "# Two\n" },
    { name: "src/main.js", data: "main\n" },
    { name: "top.txt", data: "top\n" },
  ]),
  [B.path]: zipOf([
    { name: "inner.zip", data: INNER },
    { name: "b.txt", data: "b\n" },
  ]),
});

type Mounted = Awaited<ReturnType<typeof mount>>;

/** Archives with A and B open: A left with docs open, two.md selected and top.txt marked; B on screen, one level down in inner.zip, deep open, sorted by size and filtered. */
async function twoArchives(files = FILES()) {
  const first = await mount({ files, grants: [DOWNLOADS] });
  await first.host.command("desk.files.visit", A);
  first.app.toggle("docs");
  await first.app.select("docs/two.md");
  first.app.mark("top.txt");
  first.view.row = 3;
  await first.host.command("desk.files.visit", B);
  await first.app.select("inner.zip");
  await first.app.open("inner.zip");
  first.app.toggle("deep");
  await first.app.select("deep/inner.txt");
  first.app.sort("size");
  first.view.row = 1;
  await first.settle();
  return first;
}

const asleep = async (mounted: Mounted) =>
  ((await mounted.host.surfaceState()) as { state: unknown }).state;

describe("put to sleep while hidden, and back", () => {
  it("answers ui.surface.state with its archives, the one on screen, each one's levels and place", async () => {
    const first = await twoArchives();
    expect(await asleep(first)).toEqual({
      v: 1,
      files: [
        {
          ...A,
          place: {
            levels: [{ expanded: ["docs"], selected: "docs/two.md", marked: ["top.txt"] }],
            top: 3,
            sort: { by: "size", descending: false },
            watchId: "w1",
          },
        },
        {
          ...B,
          place: {
            levels: [
              { expanded: [], selected: "inner.zip", marked: [] },
              { from: "inner.zip", expanded: ["deep"], selected: "deep/inner.txt", marked: [] },
            ],
            top: 1,
            sort: { by: "size", descending: false },
            watchId: "w1",
          },
        },
      ],
      shown: B.buffer,
    });
  });

  it("comes back to the archive on screen, one level down as it was, without asking or taking the focus", async () => {
    const state = await asleep(await twoArchives());
    const second = await mount({ files: FILES(), grants: [DOWNLOADS], restored: state });
    await vi.waitFor(() =>
      expect(second.view.archives.at(-1)).toMatchObject({
        buffer: B.buffer,
        levels: ["b.zip", "inner.zip"],
        selected: "deep/inner.txt",
        sort: { by: "size", descending: false },
        top: 1,
      }),
    );
    expect(rowNames(second.view)).toEqual(["deep", "inner.txt", "x.txt"]);
    expect(second.view.focused).toBe(0);
    expect(second.params("perm.request")).toEqual([]);
    // Its watch from before the sleep still follows it: nothing is watched anew.
    expect(second.params("fs.watch")).toEqual([]);
    second.host.emit({
      event: "fs.changed",
      data: { watchId: "w1", path: B.path, change: "modified" },
    });
    await second.settle();
    expect(second.ran("desk.files.changed")).toEqual([{ path: B.path }]);
    // The preview follows the selection that came back.
    expect(second.view.previews.at(-1)).toMatchObject({ name: "inner.txt", text: "inner\n" });
  });

  it("opens a kept archive that was not on screen as it was, once it is shown", async () => {
    const state = await asleep(await twoArchives());
    const second = await mount({ files: FILES(), grants: [DOWNLOADS], restored: state });
    await vi.waitFor(() => expect(second.view.archives.at(-1)).toMatchObject({ buffer: B.buffer }));
    await expect(second.host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(second.view.archives.at(-1)).toMatchObject({
      buffer: A.buffer,
      levels: ["a.zip"],
      selected: "docs/two.md",
      top: 3,
    });
    // Sorted by size as the frame was: the folders first, the smaller one first.
    expect(rowNames(second.view)).toEqual(["src", "docs", "one.md", "two.md", "top.txt"]);
    expect(second.view.archives.at(-1)?.rows.find((r) => r.name === "top.txt")?.marked).toBe(true);
    expect(second.view.focused).toBe(1);
    expect(((await asleep(second)) as { files: unknown[] }).files).toHaveLength(2);
  });

  it("a show of the archive on screen while it opens again waits for it", async () => {
    const state = await asleep(await twoArchives());
    const second = await mount({
      files: FILES(),
      grants: [DOWNLOADS],
      restored: state,
      settled: false,
    });
    await expect(second.host.command("desk.buffers.show", B)).resolves.toBeUndefined();
    expect(second.view.archives.at(-1)).toMatchObject({
      buffer: B.buffer,
      levels: ["b.zip", "inner.zip"],
    });
    expect(second.view.focused).toBe(1);
  });

  it("keeps the archives it has not opened again when it sleeps once more", async () => {
    const state = await asleep(await twoArchives());
    const second = await mount({ files: {}, restored: state });
    await second.settle();
    const again = (await asleep(second)) as { files: Array<{ path: string }>; shown: string };
    expect(again.files.map((f) => f.path)).toEqual([A.path, B.path]);
    expect(again.shown).toBe(B.buffer);
  });

  it("forgets a kept archive the desk closes", async () => {
    const state = await asleep(await twoArchives());
    const second = await mount({ files: FILES(), grants: [DOWNLOADS], restored: state });
    await second.host.command("desk.buffers.closed", A);
    await expect(second.host.command("desk.buffers.show", A)).rejects.toThrow(
      `No archive ${A.buffer}.`,
    );
    await vi.waitFor(() => expect(second.view.archives.at(-1)).toMatchObject({ buffer: B.buffer }));
    const again = (await asleep(second)) as { files: Array<{ path: string }> };
    expect(again.files.map((f) => f.path)).toEqual([B.path]);
  });

  it("opens again on show and on revert an archive the desk lists that its page lost (#162)", async () => {
    const cold = await mount({ files: FILES(), grants: [DOWNLOADS] });
    await expect(cold.host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(cold.view.archives.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.zip" });
    expect(cold.view.focused).toBe(1);
    await expect(cold.host.command("desk.files.revert", B)).resolves.toBeUndefined();
    expect(cold.view.archives.at(-1)).toMatchObject({ buffer: B.buffer, name: "b.zip" });
  });

  it("does not ask for a folder as it wakes; the person's show of the archive does", async () => {
    const state = await asleep(await twoArchives());
    const second = await mount({ files: FILES(), restored: state });
    // No grant covers the folder in this frame's desk: waking, it says so and asks nothing.
    await vi.waitFor(() =>
      expect(second.view.statuses.at(-1)).toBe(`Not allowed to read ${B.path}.`),
    );
    expect(second.params("perm.request")).toEqual([]);
    expect(second.view.archives.at(-1)).toBeNull();
    await second.host.command("desk.buffers.show", B);
    expect(second.params("perm.request")).toEqual([
      { permission: DOWNLOADS, reason: `To open ${B.path} in Archives` },
    ]);
    expect(second.view.archives.at(-1)).toMatchObject({
      buffer: B.buffer,
      selected: "deep/inner.txt",
    });
  });

  it("a show of another archive while the one on screen wakes stays on screen", async () => {
    const state = await asleep(await twoArchives());
    const second = await mount({
      files: FILES(),
      grants: [DOWNLOADS],
      restored: state,
      settled: false,
    });
    await second.host.command("desk.buffers.show", A);
    await second.settle();
    expect(second.view.archives.at(-1)).toMatchObject({ buffer: A.buffer });
    // B came back meanwhile, held but not put over what the person asked for.
    expect(((await asleep(second)) as { shown: string }).shown).toBe(A.buffer);
  });

  it("starts empty from a state it cannot read", async () => {
    const cold = await mount({ files: FILES(), restored: { archives: [] } });
    expect(cold.view.archives.at(-1)).toBeNull();
    expect(await asleep(cold)).toEqual({ v: 1, files: [], shown: null });
  });
});
