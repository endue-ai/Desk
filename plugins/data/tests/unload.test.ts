// The desk puts a Data window nobody sees to sleep and loads it again when it shows (ADR 0070, ADR
// 0176): Data answers ui.surface.state through the SDK's keepFiles with its files, the one on screen,
// how each was shown and its unsaved values, and comes back to them; a file the desk lists that the
// frame lost opens again when it is shown, instead of "No file" (#162).
import { describe, expect, it, vi } from "vitest";
import { bytesSum } from "../ui/edit/sum.js";
import type { Where } from "../ui/keep.js";
import { MAX_OPEN } from "../ui/keep.js";
import { plainOf } from "../ui/tree.js";
import { type Commands, denied, disk, file, type Handlers, mount } from "./harness";
import { rootOf } from "./nodes";

const A = file("~/data/a.json");
const B = file("~/data/b.yaml");
const JSON_TEXT = '{\n  "name": "desk",\n  "count": 1\n}\n';
const YAML_TEXT = "name: desk # the name\nlist:\n  - one\n  - two\n";
const AT_A: Where = { mode: "tree", expanded: ["0"], selected: "0/1" };
const AT_B: Where = { mode: "raw", expanded: ["0", "0/1"], selected: "0/1/0" };
const DESK: Commands = { "desk.buffers.update": () => undefined };
const decoded = (content: unknown) => Buffer.from(String(content), "base64").toString("utf8");

type Mounted = Awaited<ReturnType<typeof mount>>;
const asleep = async (mounted: Mounted) =>
  ((await mounted.host.surfaceState()) as { state: unknown }).state;
/** The plain value the view shows last. */
const shownValue = (mounted: Mounted) => {
  const opened = mounted.view.shown.at(-1)?.opened;
  return opened?.doc ? plainOf(rootOf(opened.doc)) : undefined;
};

/** The disk, with fs.write storing what the plugin writes. */
function writable(files: Record<string, string>, extra: Handlers = {}): Handlers {
  return {
    ...disk(files),
    "fs.write": ({ path, content }) => {
      files[path] = decoded(content);
      return { bytesWritten: Buffer.from(String(content), "base64").length };
    },
    ...extra,
  };
}

/** Data with B and then A open, A on screen with its count set to 2 and not saved. */
async function edited(files: Record<string, string>) {
  const first = await mount({ handlers: writable(files), commands: DESK });
  await first.host.command("desk.files.visit", B);
  await first.host.command("desk.files.visit", A);
  first.view.places.set(A.buffer, AT_A);
  first.view.places.set(B.buffer, AT_B);
  await first.app.edit([0, 1], "2");
  await first.settle();
  return first;
}

describe("put to sleep while hidden, and back", () => {
  it("answers ui.surface.state with its files, the one on screen, how each was shown, their watches and A's value", async () => {
    const first = await edited({ [A.path]: JSON_TEXT, [B.path]: YAML_TEXT });
    expect(await asleep(first)).toEqual({
      v: 1,
      files: [
        { ...B, place: { ...AT_B, watchId: "w1" } },
        {
          ...A,
          place: { ...AT_A, watchId: "w2" },
          edit: {
            values: [[[0, 1], "2"]],
            size: JSON_TEXT.length,
            sum: bytesSum(new TextEncoder().encode(JSON_TEXT)),
            reported: true,
          },
        },
      ],
      shown: A.buffer,
    });
  });

  it("comes back to the file on screen with its unsaved value, still marked, without asking or taking the focus", async () => {
    const files = { [A.path]: JSON_TEXT, [B.path]: YAML_TEXT };
    const state = await asleep(await edited(files));
    const second = await mount({ handlers: writable(files), commands: DESK, restored: state });
    await vi.waitFor(() => expect(shownValue(second)).toEqual({ name: "desk", count: 2 }));
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer });
    // How it was shown goes back to the view before the file shows.
    expect(second.view.restored).toEqual([[A.buffer, AT_A]]);
    expect(second.view.focused).toBe(0);
    expect(second.params("perm.request")).toEqual([]);
    // The desk still marks it unsaved: nothing to tell it, and nothing cleared.
    expect(second.ran("desk.buffers.update")).toEqual([]);
    expect(second.view.statuses.at(-1)).toBe("Opened a.json as JSON.");
    // Its watch from before the sleep still follows it: nothing is watched anew.
    expect(second.params("fs.watch")).toEqual([]);
    second.host.emit({
      event: "fs.changed",
      data: { watchId: "w2", path: A.path, change: "modified" },
    });
    await second.settle();
    expect(second.ran("desk.files.changed")).toEqual([{ path: A.path }]);
    // A save writes the value the sleep kept.
    await second.host.command("desk.files.save", A);
    expect(files[A.path]).toBe('{\n  "name": "desk",\n  "count": 2\n}\n');
  });

  it("opens a kept file that was not on screen as it was shown, once it is shown", async () => {
    const files = { [A.path]: JSON_TEXT, [B.path]: YAML_TEXT };
    const state = await asleep(await edited(files));
    const second = await mount({ handlers: writable(files), commands: DESK, restored: state });
    await vi.waitFor(() => expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer }));
    await second.host.command("desk.buffers.show", B);
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer, name: "b.yaml" });
    expect(second.view.restored.at(-1)).toEqual([B.buffer, AT_B]);
    expect(second.view.focused).toBeGreaterThan(0);
    // Asleep again, both are kept, B now from the frame and A with its value.
    second.view.places.set(B.buffer, AT_B);
    const again = (await asleep(second)) as { files: Array<{ buffer: string; edit?: unknown }> };
    expect(again.files.map((f) => [f.buffer, f.edit !== undefined])).toEqual([
      [A.buffer, true],
      [B.buffer, false],
    ]);
  });

  it("a file changed on disk while it slept opens as it is there; the desk's mark is cleared and the person told", async () => {
    const files = { [A.path]: JSON_TEXT, [B.path]: YAML_TEXT };
    const state = await asleep(await edited(files));
    files[A.path] = '{\n  "name": "desk",\n  "count": 7\n}\n';
    const second = await mount({ handlers: writable(files), commands: DESK, restored: state });
    await vi.waitFor(() =>
      expect(second.view.statuses.at(-1)).toBe(
        "The unsaved changes to a.json could not be kept while its window slept.",
      ),
    );
    expect(shownValue(second)).toEqual({ name: "desk", count: 7 });
    expect(second.ran("desk.buffers.update")).toEqual([{ id: A.buffer, modified: false }]);
  });

  it("a save keeps only the values set after it; the file on disk is what they are checked against", async () => {
    const files = { [A.path]: JSON_TEXT };
    const first = await mount({ handlers: writable(files), commands: DESK });
    await first.host.command("desk.files.visit", A);
    await first.app.edit([0, 1], "2");
    await first.host.command("desk.files.save", A);
    expect(((await asleep(first)) as { files: Array<{ edit?: unknown }> }).files[0]?.edit).toBe(
      undefined,
    );
    await first.app.edit([0, 0], "Desk");
    const state = (await asleep(first)) as { files: Array<{ edit?: { values: unknown } }> };
    expect(state.files[0]?.edit?.values).toEqual([[[0, 0], "Desk"]]);

    const second = await mount({ handlers: writable(files), commands: DESK, restored: state });
    await vi.waitFor(() => expect(shownValue(second)).toEqual({ name: "Desk", count: 2 }));
  });

  it("a show of the file on screen while it opens again waits for it, and shows it there", async () => {
    const files = { [A.path]: JSON_TEXT, [B.path]: YAML_TEXT };
    const state = await asleep(await edited(files));
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const plain = writable(files);
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
      commands: DESK,
      restored: state,
      settled: false,
    });
    const show = second.host.command("desk.buffers.show", A);
    release();
    await expect(show).resolves.toBeUndefined();
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer });
    expect(shownValue(second)).toEqual({ name: "desk", count: 2 });
    expect(second.view.focused).toBe(1);
  });

  it("keeps the files it has not opened again when it sleeps once more", async () => {
    const files = { [A.path]: JSON_TEXT, [B.path]: YAML_TEXT };
    const state = await asleep(await edited(files));
    const second = await mount({ handlers: disk({}), commands: DESK, restored: state });
    await vi.waitFor(() => expect(second.view.statuses.at(-1)).toMatch(/^Could not read/));
    expect(await asleep(second)).toEqual(state);
  });

  it("forgets a kept file the desk closes", async () => {
    const files = { [A.path]: JSON_TEXT, [B.path]: YAML_TEXT };
    const state = await asleep(await edited(files));
    const second = await mount({ handlers: writable(files), commands: DESK, restored: state });
    await vi.waitFor(() => expect(second.view.shown.at(-1)).toMatchObject({ buffer: A.buffer }));
    await expect(second.host.command("desk.buffers.closed", B)).resolves.toBeUndefined();
    await expect(second.host.command("desk.buffers.show", B)).rejects.toThrow(
      `No file ${B.buffer}.`,
    );
    const again = (await asleep(second)) as { files: Array<{ path: string }> };
    expect(again.files.map((f) => f.path)).toEqual([A.path]);
  });

  it("opens again on show a file the desk lists that its page lost (#162)", async () => {
    const cold = await mount({ handlers: disk({ [A.path]: JSON_TEXT }), commands: DESK });
    await expect(cold.host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(cold.view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.json" });
    expect(cold.view.focused).toBeGreaterThan(0);
    expect(cold.ran("desk.buffers.update")).toEqual([{ id: A.buffer, modified: false }]);
    expect(cold.view.statuses.at(-1)).toBe("a.json was opened again from disk.");
  });

  it("revert of a kept file opens it from disk without the value; save of one writes the value", async () => {
    const files = { [A.path]: JSON_TEXT, [B.path]: YAML_TEXT };
    const state = { ...((await asleep(await edited(files))) as object), shown: B.buffer };
    const second = await mount({ handlers: writable(files), commands: DESK, restored: state });
    await vi.waitFor(() => expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer }));
    await second.host.command("desk.files.save", A);
    expect(files[A.path]).toBe('{\n  "name": "desk",\n  "count": 2\n}\n');
    expect(second.view.shown.at(-1)).toMatchObject({ buffer: B.buffer });

    const third = await mount({
      handlers: writable({ [A.path]: JSON_TEXT, [B.path]: YAML_TEXT }),
      commands: DESK,
      restored: state,
    });
    await vi.waitFor(() => expect(third.view.shown.at(-1)).toMatchObject({ buffer: B.buffer }));
    await third.host.command("desk.files.revert", A);
    await third.host.command("desk.buffers.show", A);
    expect(shownValue(third)).toEqual({ name: "desk", count: 1 });
  });

  it("does not ask for a folder as it wakes; the person's show of the file does", async () => {
    const files = { [A.path]: JSON_TEXT, [B.path]: YAML_TEXT };
    const state = await asleep(await edited(files));
    let allowed = false;
    const plain = writable(files);
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
      commands: DESK,
      restored: state,
    });
    await vi.waitFor(() =>
      expect(second.view.statuses.at(-1)).toBe(`Not allowed to read ${A.path}.`),
    );
    expect(second.params("perm.request")).toEqual([]);
    await second.host.command("desk.buffers.show", A);
    expect(second.params("perm.request")).toHaveLength(1);
    expect(shownValue(second)).toEqual({ name: "desk", count: 2 });
  });

  it("keeps at most a thousand open nodes of a file, those on the way to the selected one first", async () => {
    const first = await mount({ handlers: disk({ [A.path]: JSON_TEXT }), commands: DESK });
    await first.host.command("desk.files.visit", A);
    const many = Array.from({ length: 3000 }, (_, i) => `0/${i}`);
    first.view.places.set(A.buffer, {
      mode: "both",
      expanded: [...many, "0/2999/4"],
      selected: "0/2999/4/1",
    });
    const state = (await asleep(first)) as { files: Array<{ place: Where }> };
    const kept = state.files[0]?.place.expanded ?? [];
    expect(kept).toHaveLength(MAX_OPEN);
    expect(kept.slice(0, 2)).toEqual(["0/2999", "0/2999/4"]);
  });

  it("starts empty from a state it cannot read", async () => {
    const cold = await mount({ handlers: disk({}), commands: DESK, restored: { notes: [] } });
    expect(cold.view.shown.at(-1)).toBeNull();
    expect(await asleep(cold)).toEqual({ v: 1, files: [], shown: null });
  });
});
