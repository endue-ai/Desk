// @vitest-environment jsdom
// The desk puts a slides window nobody sees to sleep and loads it again when it shows (ADR 0070, ADR
// 0176): Slides answers ui.surface.state through the SDK's keepFiles with its presentations, the one
// on screen, the slide each was on and their watches, and comes back to them; a presentation the
// desk lists that the frame lost opens again when it is shown, instead of "No presentation" (#162).
import { describe, expect, it, vi } from "vitest";
import { denied, disk, file, type Handlers, mount, readScope } from "./harness";
import { pptx, title } from "./pptx";

const A = file("~/Decks/a.pptx");
const B = file("~/Decks/b.pptx");
const DECKS = readScope("~/Decks");
const deck = (...titles: string[]) => pptx(titles.map((t) => ({ shapes: title(t) })));
const FILES = () => ({ [A.path]: deck("A1", "A2", "A3"), [B.path]: deck("B1", "B2", "B3", "B4") });

/** Slides with A and B open: the person left A on its third slide, and is on B's fourth. */
async function twoDecks(handlers: Handlers = disk(FILES())) {
  const first = await mount({ handlers });
  await first.host.command("desk.files.visit", A);
  first.view.at[A.buffer] = 2;
  await first.host.command("desk.files.visit", B);
  first.view.at[B.buffer] = 3;
  return first;
}

const asleep = async (mounted: Awaited<ReturnType<typeof mount>>) =>
  ((await mounted.host.surfaceState()) as { state: unknown }).state;

describe("put to sleep while hidden, and back", () => {
  it("answers ui.surface.state with its presentations, the one on screen, each one's slide and watch", async () => {
    const first = await twoDecks();
    expect(await asleep(first)).toEqual({
      v: 1,
      files: [
        { ...A, place: { slide: 2, watchId: "w1" } },
        { ...B, place: { slide: 3, watchId: "w2" } },
      ],
      shown: B.buffer,
    });
  });

  it("comes back to the presentation on screen on its slide, without asking or taking the focus", async () => {
    const state = await asleep(await twoDecks());
    const second = await mount({ handlers: disk(FILES()), restored: state });
    await vi.waitFor(() =>
      expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer, name: "b.pptx" }),
    );
    expect(second.view.slides.at(-1)).toBe(3);
    expect(second.view.focused).toBe(0);
    expect(second.params("perm.request")).toEqual([]);
    expect(second.view.statuses.at(-1)).toBe("b.pptx: 4 slides.");
    // Its watch from before the sleep still follows it: nothing is watched anew.
    expect(second.params("fs.watch")).toEqual([]);
    second.host.emit({
      event: "fs.changed",
      data: { watchId: "w2", path: B.path, change: "modified" },
    });
    await second.settle();
    expect(second.ran("desk.files.changed")).toEqual([{ path: B.path }]);
  });

  it("opens a kept presentation that was not on screen on its slide, once it is shown", async () => {
    const state = await asleep(await twoDecks());
    const second = await mount({ handlers: disk(FILES()), restored: state });
    await vi.waitFor(() => expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer }));
    await expect(second.host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.pptx" });
    expect(second.view.slides.at(-1)).toBe(2);
    expect(second.view.focused).toBe(1);
    expect(((await asleep(second)) as { files: unknown[] }).files).toHaveLength(2);
  });

  it("a show of the presentation on screen while it opens again waits for it", async () => {
    const state = await asleep(await twoDecks());
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
    expect(second.view.slides).toContain(3);
    expect(second.view.at[B.buffer]).toBe(3);
    expect(second.view.focused).toBe(1);
  });

  it("keeps the presentations it has not opened again when it sleeps once more", async () => {
    const state = await asleep(await twoDecks());
    const second = await mount({ handlers: disk({}), restored: state });
    const again = (await asleep(second)) as { files: Array<{ path: string }> };
    expect(again.files.map((f) => f.path)).toEqual([A.path, B.path]);
  });

  it("forgets a kept presentation the desk closes", async () => {
    const state = await asleep(await twoDecks());
    const second = await mount({ handlers: disk(FILES()), restored: state });
    await second.host.command("desk.buffers.closed", A);
    await expect(second.host.command("desk.buffers.show", A)).rejects.toThrow(
      `No presentation ${A.buffer}.`,
    );
    const again = (await asleep(second)) as { files: Array<{ path: string }> };
    expect(again.files.map((f) => f.path)).toEqual([B.path]);
  });

  it("opens again on show and on revert a presentation the desk lists that its page lost (#162)", async () => {
    const cold = await mount({ handlers: disk(FILES()) });
    await expect(cold.host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(cold.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.pptx" });
    expect(cold.view.focused).toBe(1);
    await expect(cold.host.command("desk.files.revert", B)).resolves.toBeUndefined();
    expect(cold.view.shown.at(-1)).toMatchObject({ buffer: B.buffer, name: "b.pptx" });
  });

  it("does not ask for a folder as it wakes; the person's show of the presentation does", async () => {
    const state = await asleep(await twoDecks());
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
      { permission: DECKS, reason: `To open ${B.path} in Slides` },
    ]);
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer });
    expect(second.view.slides.at(-1)).toBe(3);
  });

  it("starts empty from a state it cannot read", async () => {
    const cold = await mount({ handlers: disk({}), restored: { decks: [] } });
    expect(cold.view.shown.at(-1)).toBeNull();
    expect(await asleep(cold)).toEqual({ v: 1, files: [], shown: null });
  });
});
