// @vitest-environment jsdom
// The desk puts a player window nobody sees to sleep and loads it again when it shows (ADR 0070, ADR
// 0176): the player answers ui.surface.state through the SDK's keepFiles with its files, the one on
// screen and where the person was in each (the position, a playlist's entry, the subtitles chosen and
// their offset, the watch), and comes back to them paused; a file the desk lists that the frame lost
// opens again when it is shown, instead of "No file" (#162).
import { describe, expect, it, vi } from "vitest";
import { file, fixture, folderScope, mount } from "./harness";

const V = file("~/Movies/film.mp4");
const A = file("~/Music/tone.m4a");
const P = file("~/Music/mix.m3u");
const SRT = "1\n00:00:01,000 --> 00:00:02,500\nHello\n";
const FILES = {
  [V.path]: fixture("clip.mp4"),
  "~/Movies/film.srt": SRT,
  "~/Movies/film.ko.srt": SRT.replace("Hello", "안녕"),
  [A.path]: fixture("tone.m4a"),
  [P.path]: "#EXTINF:1,One\none.mp3\n#EXTINF:1,Two\ntwo.flac\n",
  "~/Music/one.mp3": fixture("tone-v24.mp3"),
  "~/Music/two.flac": fixture("tone.flac"),
};
const GRANTS = ["~/Movies/**", "~/Music/**"];

type Mounted = Awaited<ReturnType<typeof mount>>;
const asleep = async (mounted: Mounted) =>
  ((await mounted.host.surfaceState()) as { state: unknown }).state;

/** A player with the video and the song open, the video on screen at 12.5 s, Korean subtitles 0.3 s later. */
async function twoFiles(options: Parameters<typeof mount>[0] = {}) {
  const first = await mount({ files: FILES, grants: GRANTS, ...options });
  await first.host.command("desk.files.visit", A);
  await first.host.command("desk.files.visit", V);
  await first.settle();
  first.app.subtitle("~/Movies/film.ko.srt");
  first.app.offset(0.1);
  first.app.offset(0.1);
  first.app.offset(0.1);
  first.app.progress({ time: 12.5, duration: 20, paused: true });
  await first.settle();
  return first;
}

describe("put to sleep while hidden, and back", () => {
  it("answers ui.surface.state with its files, the one on screen, the place in each and their watches", async () => {
    const first = await twoFiles();
    expect(await asleep(first)).toEqual({
      v: 1,
      files: [
        { ...A, place: { position: 0, watchId: "w1" } },
        {
          ...V,
          place: { position: 12.5, subtitle: "~/Movies/film.ko.srt", offset: 0.3, watchId: "w2" },
        },
      ],
      shown: V.buffer,
    });
  });

  it("comes back to the file on screen at its position and subtitles, without asking or taking the focus", async () => {
    const state = await asleep(await twoFiles());
    const second = await mount({ files: FILES, grants: GRANTS, restored: state });
    await vi.waitFor(() =>
      expect(second.shown()).toMatchObject({
        buffer: V.buffer,
        mode: "media",
        element: "video",
        start: 12.5,
        subtitles: { selected: "~/Movies/film.ko.srt", offset: 0.3 },
      }),
    );
    expect(second.shown()?.cues?.[0]).toEqual({ start: 1.3, end: 2.8, text: "안녕" });
    // Where it was, it is not offered to resume from the start again.
    expect(second.shown()?.resume).toBeUndefined();
    expect(second.view.focused).toBe(0);
    expect(second.params("perm.request")).toEqual([]);
    // Its watch from before the sleep still follows it: nothing is watched anew.
    expect(second.params("fs.watch")).toEqual([]);
    second.host.emit({
      event: "fs.changed",
      data: { watchId: "w2", path: V.path, change: "modified" },
    });
    await second.settle();
    expect(second.ran("desk.files.changed")).toEqual([{ path: V.path }]);
  });

  it("opens a kept file that was not on screen where it was, once it is shown", async () => {
    const first = await twoFiles();
    await first.host.command("desk.buffers.show", A);
    first.app.progress({ time: 0.4, duration: 1, paused: true });
    await first.host.command("desk.buffers.show", V);
    const state = await asleep(first);

    const second = await mount({ files: FILES, grants: GRANTS, restored: state });
    await vi.waitFor(() => expect(second.shown()).toMatchObject({ buffer: V.buffer }));
    await second.host.command("desk.buffers.show", A);
    expect(second.shown()).toMatchObject({ buffer: A.buffer, mode: "media", start: 0.4 });
    expect(second.view.focused).toBe(1);
    // Asleep again, both are kept, A now from the frame and V still from the frame too.
    expect(((await asleep(second)) as { files: unknown[] }).files).toHaveLength(2);
  });

  it("a playlist comes back on its entry and where it was in it", async () => {
    const first = await mount({ files: FILES, grants: GRANTS });
    await first.host.command("desk.files.visit", P);
    first.app.next();
    await first.settle();
    first.app.progress({ time: 0.25, duration: 0.5, paused: true });
    const state = await asleep(first);
    expect(state).toMatchObject({ files: [{ ...P, place: { position: 0.25, entry: 1 } }] });

    const second = await mount({ files: FILES, grants: GRANTS, restored: state });
    await vi.waitFor(() =>
      expect(second.shown()).toMatchObject({
        buffer: P.buffer,
        item: { path: "~/Music/two.flac" },
        playlist: { index: 1 },
        start: 0.25,
      }),
    );
    expect(second.params("fs.url").map((p) => (p as { path: string }).path)).toEqual([
      "~/Music/two.flac",
    ]);
  });

  it("a show of the file on screen while it opens again waits for it, and shows it there", async () => {
    const state = await asleep(await twoFiles());
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const second = await mount({
      files: FILES,
      grants: GRANTS,
      restored: state,
      handlers: {
        "fs.url": async () => {
          await gate;
          return { url: "data:video/mp4;base64,", size: 6283, type: "video/mp4" };
        },
      },
      settled: false,
    });
    expect(second.shown()).toBeNull();
    // The desk woke the window to show V, the file it had on screen, which is still opening.
    const show = second.host.command("desk.buffers.show", V);
    release();
    await expect(show).resolves.toBeUndefined();
    expect(second.shown()).toMatchObject({ buffer: V.buffer, mode: "media", start: 12.5 });
    expect(second.view.focused).toBe(1);
  });

  it("keeps the files it has not opened again when it sleeps once more", async () => {
    const state = (await asleep(await twoFiles())) as { files: Array<{ path: string }> };
    const second = await mount({ files: FILES, grants: GRANTS, restored: state });
    await vi.waitFor(() => expect(second.shown()).toMatchObject({ buffer: V.buffer }));
    const again = (await asleep(second)) as typeof state;
    expect(again.files.map((f) => f.path)).toEqual([A.path, V.path]);
  });

  it("forgets a kept file the desk closes", async () => {
    const state = await asleep(await twoFiles());
    const second = await mount({ files: FILES, grants: GRANTS, restored: state });
    await second.host.command("desk.buffers.closed", A);
    await expect(second.host.command("desk.buffers.show", A)).rejects.toThrow(
      `No file ${A.buffer}.`,
    );
    await vi.waitFor(() => expect(second.shown()).toMatchObject({ buffer: V.buffer }));
    const again = (await asleep(second)) as { files: Array<{ path: string }> };
    expect(again.files.map((f) => f.path)).toEqual([V.path]);
  });

  it("opens again on show a file the desk lists that its page lost (#162)", async () => {
    // A page that loaded again without a kept state holds nothing; the desk still lists V.
    const cold = await mount({ files: FILES, grants: GRANTS });
    await expect(cold.host.command("desk.buffers.show", V)).resolves.toBeUndefined();
    expect(cold.shown()).toMatchObject({ buffer: V.buffer, name: "film.mp4", mode: "media" });
    expect(cold.view.focused).toBe(1);
    await expect(cold.host.command("desk.files.revert", A)).resolves.toBeUndefined();
    expect(cold.shown()).toMatchObject({ buffer: A.buffer, mode: "media" });
  });

  it("does not ask for a folder as it wakes; the person's show of the file does", async () => {
    const state = await asleep(await twoFiles());
    // No grants: the wake reads nothing and asks nothing; the show asks, and is granted.
    const second = await mount({ files: FILES, restored: state });
    await vi.waitFor(() =>
      expect(second.view.statuses.at(-1)).toBe(`Not allowed to read ${V.path}.`),
    );
    expect(second.params("perm.request")).toEqual([]);
    await second.host.command("desk.buffers.show", V);
    expect(second.params("perm.request")).toEqual([
      expect.objectContaining({ permission: folderScope("~/Movies") }),
    ]);
    expect(second.shown()).toMatchObject({ buffer: V.buffer, mode: "media", start: 12.5 });
    expect(second.view.focused).toBe(1);
  });

  it("starts empty from a state it cannot read", async () => {
    const cold = await mount({ files: FILES, restored: { entries: [] } });
    expect(cold.shown()).toBeNull();
    expect(await asleep(cold)).toEqual({ v: 1, files: [], shown: null });
  });
});
