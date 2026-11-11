// The desk puts a Sheets window nobody sees to sleep and loads it again when it shows (ADR 0070, ADR
// 0176): Sheets answers ui.surface.state through the SDK's keepFiles with its files, the one on
// screen, the place in each and a CSV's unsaved edits, and comes back to them; a file the desk lists
// that the frame lost opens again when it is shown, instead of "No spreadsheet" (#162).
import { describe, expect, it, vi } from "vitest";
import { assertMinimalEdit } from "../../../packages/plugin-sdk/src/testing/round-trip";
import type { Where } from "../ui/keep.js";
import { bytesSum } from "../ui/keep.js";
import { denied, disk, file, fixture, mount } from "./harness";

const A = file("~/Documents/cities.csv");
const B = file("~/Documents/budget.xlsx");
const CITIES = fixture("crlf-bom-quotes.csv");
const BUDGET = fixture("budget.xlsx");
/** Where the person was in A: its one sheet, B5 selected, scrolled down. */
const AT_A: Where = {
  sheet: 0,
  places: [[0, { active: { r: 4, c: 1 }, end: { r: 4, c: 1 }, top: 60, left: 0 }]],
  zoom: 1.25,
};
const AT_B: Where = {
  sheet: 1,
  places: [[1, { active: { r: 2, c: 2 }, end: { r: 3, c: 3 }, top: 0, left: 30 }]],
  zoom: 1.25,
};

type Mounted = Awaited<ReturnType<typeof mount>>;
const asleep = async (mounted: Mounted) =>
  ((await mounted.host.surfaceState()) as { state: unknown }).state;
const textAt = (mounted: Mounted, r: number, c: number) => {
  const book = mounted.view.shown.at(-1)?.book;
  return book?.kind === "sheets" ? book.sheets[0]?.text(r, c) : undefined;
};

/** Sheets with B and then A open, A on screen with Seoul's name edited and not saved. */
async function edited(files: Record<string, Uint8Array>) {
  const first = await mount({ handlers: disk(files) });
  await first.host.command("desk.files.visit", B);
  await first.host.command("desk.files.visit", A);
  first.view.places.set(A.buffer, AT_A);
  first.view.places.set(B.buffer, AT_B);
  expect(first.app.edit(1, 0, "Seoul, South Korea")).toBe(true);
  await first.settle();
  return first;
}

describe("put to sleep while hidden, and back", () => {
  it("answers ui.surface.state with its files, the one on screen, the place in each, their watches and A's edit", async () => {
    const first = await edited({ [A.path]: CITIES, [B.path]: BUDGET });
    expect(await asleep(first)).toEqual({
      v: 1,
      files: [
        { ...B, place: { ...AT_B, watchId: "w1" } },
        {
          ...A,
          place: { ...AT_A, watchId: "w2" },
          edit: {
            cells: [[1, 0, "Seoul, South Korea"]],
            size: CITIES.length,
            sum: bytesSum(CITIES),
            reported: true,
          },
        },
      ],
      shown: A.buffer,
    });
  });

  it("comes back to the file on screen with its unsaved edit, still marked, without asking or taking the focus", async () => {
    const files = { [A.path]: CITIES, [B.path]: BUDGET };
    const state = await asleep(await edited(files));
    const second = await mount({ handlers: disk(files), restored: state });
    await vi.waitFor(() =>
      expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, modified: true }),
    );
    expect(textAt(second, 1, 0)).toBe("Seoul, South Korea");
    // The place goes back to the view before the file shows, the zoom with the file on screen.
    expect(second.view.restored).toEqual([[A.buffer, AT_A]]);
    expect(second.view.focused).toBe(0);
    expect(second.params("perm.request")).toEqual([]);
    // The desk still marks it unsaved: nothing to tell it, and nothing cleared.
    expect(second.ran("desk.buffers.update")).toEqual([]);
    expect(second.view.statuses.at(-1)).toBe("Opened cities.csv: 1 sheet.");
    // Its watch from before the sleep still follows it: nothing is watched anew.
    expect(second.params("fs.watch")).toEqual([]);
    second.host.emit({
      event: "fs.changed",
      data: { watchId: "w2", path: A.path, change: "modified" },
    });
    await second.settle();
    expect(second.ran("desk.files.changed")).toEqual([{ path: A.path }]);
    // A save writes the edit the sleep kept, and only it.
    await second.host.command("desk.files.save", A);
    assertMinimalEdit(CITIES, files[A.path] as Uint8Array, [
      { find: '"Seoul, KR"', bytes: '"Seoul, South Korea"' },
    ]);
  });

  it("opens a kept file that was not on screen where it was, once it is shown", async () => {
    const files = { [A.path]: CITIES, [B.path]: BUDGET };
    const state = await asleep(await edited(files));
    const second = await mount({ handlers: disk(files), restored: state });
    await vi.waitFor(() => expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer }));
    await second.host.command("desk.buffers.show", B);
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer, name: "budget.xlsx" });
    // Its place, not its zoom: the zoom is the one on screen now.
    expect(second.view.restored.at(-1)).toEqual([B.buffer, { ...AT_B, zoom: undefined }]);
    expect(second.view.focused).toBeGreaterThan(0);
    expect(second.view.statuses.at(-1)).toBe("Opened budget.xlsx: 2 sheets.");
    // Asleep again, both are kept, B now from the frame and A with its edit.
    second.view.places.set(B.buffer, AT_B);
    const again = (await asleep(second)) as { files: Array<{ buffer: string; edit?: unknown }> };
    expect(again.files.map((f) => [f.buffer, f.edit !== undefined])).toEqual([
      [A.buffer, true],
      [B.buffer, false],
    ]);
  });

  it("a file changed on disk while it slept opens as it is there; the desk's mark is cleared and the person told", async () => {
    const files = { [A.path]: CITIES, [B.path]: BUDGET };
    const state = await asleep(await edited(files));
    files[A.path] = new TextEncoder().encode("city,country\nDaejeon,Korea\n");
    const second = await mount({ handlers: disk(files), restored: state });
    await vi.waitFor(() =>
      expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, modified: false }),
    );
    expect(textAt(second, 1, 0)).toBe("Daejeon");
    expect(second.ran("desk.buffers.update")).toEqual([{ id: A.buffer, modified: false }]);
    const lost = "The unsaved changes to cities.csv could not be kept while its window slept.";
    expect(second.view.statuses.at(-1)).toBe(lost);
    // It stays said when the file is shown again, until the person edits it.
    await second.host.command("desk.buffers.show", A);
    expect(second.view.statuses.at(-1)).toBe(lost);
    second.app.edit(1, 0, "Sejong");
    await second.host.command("desk.buffers.show", A);
    expect(second.view.statuses.at(-1)).toBe("Opened cities.csv: 1 sheet.");
  });

  it("edits past the 64 KiB the desk keeps are not kept: the file is, and says so when it is back", async () => {
    // 3 000 rows, each edited to 30 characters: about 120 KB of cells.
    const rows = Array.from({ length: 3000 }, (_, i) => `row ${i},${i}`).join("\n");
    const big = new TextEncoder().encode(`name,n\n${rows}\n`);
    const files = { [A.path]: big };
    const first = await mount({ handlers: disk(files) });
    await first.host.command("desk.files.visit", A);
    for (let r = 1; r <= 3000; r++) first.app.edit(r, 0, `edited row ${r}`.padEnd(30, "."));
    const state = (await asleep(first)) as { files: Array<Record<string, unknown>> };
    expect(state.files).toEqual([{ ...A, place: { watchId: "w1" }, lost: true }]);
    expect(JSON.stringify(state).length).toBeLessThan(64 * 1024);

    const second = await mount({ handlers: disk(files), restored: state });
    await vi.waitFor(() =>
      expect(second.view.statuses.at(-1)).toBe(
        "The unsaved changes to cities.csv could not be kept while its window slept.",
      ),
    );
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, modified: false });
    expect(second.ran("desk.buffers.update")).toEqual([{ id: A.buffer, modified: false }]);
  });

  it("a show of the file on screen while it opens again waits for it, and shows it there", async () => {
    const files = { [A.path]: CITIES, [B.path]: BUDGET };
    const state = await asleep(await edited(files));
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
    // The desk woke the window to show A, the file it had on screen, which is still opening.
    const show = second.host.command("desk.buffers.show", A);
    release();
    await expect(show).resolves.toBeUndefined();
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, modified: true });
    expect(textAt(second, 1, 0)).toBe("Seoul, South Korea");
    expect(second.view.focused).toBe(1);
  });

  it("keeps the files it has not opened again when it sleeps once more", async () => {
    const files = { [A.path]: CITIES, [B.path]: BUDGET };
    const state = (await asleep(await edited(files))) as { files: unknown[] };
    const second = await mount({ handlers: disk({}), restored: state });
    // Neither could be read (the disk is gone): both stay kept, A with its edit.
    await vi.waitFor(() => expect(second.view.statuses.at(-1)).toMatch(/^Could not read/));
    expect(await asleep(second)).toEqual(state);
  });

  it("forgets a kept file the desk closes", async () => {
    const files = { [A.path]: CITIES, [B.path]: BUDGET };
    const state = await asleep(await edited(files));
    const second = await mount({ handlers: disk(files), restored: state });
    await vi.waitFor(() => expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer }));
    await expect(second.host.command("desk.buffers.closed", B)).resolves.toBeUndefined();
    await expect(second.host.command("desk.buffers.show", B)).rejects.toThrow(
      `No spreadsheet ${B.buffer}.`,
    );
    const again = (await asleep(second)) as { files: Array<{ path: string }> };
    expect(again.files.map((f) => f.path)).toEqual([A.path]);
  });

  it("opens again on show a file the desk lists that its page lost (#162)", async () => {
    // A page that loaded again without a kept state holds nothing; the desk still lists A.
    const cold = await mount({ handlers: disk({ [A.path]: CITIES }) });
    await expect(cold.host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(cold.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "cities.csv" });
    expect(cold.view.focused).toBeGreaterThan(0);
    // Whatever the desk marked unsaved is not here: the file is as it is on disk.
    expect(cold.ran("desk.buffers.update")).toEqual([{ id: A.buffer, modified: false }]);
    expect(cold.view.statuses.at(-1)).toBe("cities.csv was opened again from disk.");
  });

  it("revert of a kept file opens it from disk without the edit; save of one writes the edit", async () => {
    const files = { [A.path]: CITIES, [B.path]: BUDGET };
    const state = await asleep(await edited(files));
    // Back with B on screen: A is still only kept.
    const second = await mount({
      handlers: disk(files),
      restored: { ...(state as object), shown: B.buffer },
    });
    await vi.waitFor(() => expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer }));
    await second.host.command("desk.files.save", A);
    assertMinimalEdit(CITIES, files[A.path] as Uint8Array, [
      { find: '"Seoul, KR"', bytes: '"Seoul, South Korea"' },
    ]);
    // A save does not change what is on screen.
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer });

    const third = await mount({
      handlers: disk({ [A.path]: CITIES, [B.path]: BUDGET }),
      restored: { ...(state as object), shown: B.buffer },
    });
    await vi.waitFor(() => expect(third.view.shown.at(-1)).toMatchObject({ buffer: B.buffer }));
    await third.host.command("desk.files.revert", A);
    await third.host.command("desk.buffers.show", A);
    expect(third.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, modified: false });
    expect(textAt(third, 1, 0)).toBe("Seoul, KR");
  });

  it("does not ask for a folder as it wakes; the person's show of the file does", async () => {
    const files = { [A.path]: CITIES, [B.path]: BUDGET };
    const state = await asleep(await edited(files));
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
        "perm.request": () => {
          allowed = true;
          return { granted: true };
        },
      },
      restored: state,
    });
    await vi.waitFor(() =>
      expect(second.view.statuses.at(-1)).toBe(`Not allowed to read ${A.path}.`),
    );
    expect(second.params("perm.request")).toEqual([]);
    await second.host.command("desk.buffers.show", A);
    expect(second.params("perm.request")).toEqual([
      {
        permission: { permission: "fs:read", paths: ["~/Documents/**"] },
        reason: `To open ${A.path} in Sheets`,
      },
    ]);
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, modified: true });
  });

  it("starts empty from a state it cannot read", async () => {
    const cold = await mount({ handlers: disk({}), restored: { notes: [] } });
    expect(cold.view.shown.at(-1)).toBeNull();
    expect(await asleep(cold)).toEqual({ v: 1, files: [], shown: null });
  });
});
