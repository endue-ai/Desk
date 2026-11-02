// The desk unloads a notes surface nobody sees and loads it again when it shows (ADR 0070): notes
// answers ui.surface.state with what it holds and comes back from ctx.surface.restored as it was.
import { describe, expect, it } from "vitest";
import { disk, mount, NOTES_READ, note } from "./harness";

const A = note("~/Notes/a.md");
const B = note("~/Notes/b.txt");

/** Notes holding a saved A and an unsaved B on screen, its caret and scroll where the person left them. */
async function twoNotes(files: Record<string, string>) {
  const first = await mount({ handlers: disk(files) });
  await first.host.command("desk.files.visit", A);
  await first.host.command("desk.files.visit", B);
  first.app.edit("b, edited\n");
  await first.settle();
  first.view.at = { start: 3, end: 5, scroll: 40 };
  return first;
}

describe("unloaded while hidden, and back", () => {
  it("answers ui.surface.state with the notes it holds, the unsaved text only, and where the caret is", async () => {
    const first = await twoNotes({ [A.path]: "# A\n", [B.path]: "b\n" });
    const { state } = (await first.host.surfaceState()) as { state: Record<string, unknown> };
    expect(state).toMatchObject({ shown: B.buffer, caret: [3, 5], scroll: 40 });
    const kept = state.notes as Array<Record<string, unknown>>;
    expect(kept.map((n) => [n.buffer, n.path, n.modified])).toEqual([
      [A.buffer, A.path, false],
      [B.buffer, B.path, true],
    ]);
    // Saved text is on disk already: only unsaved text travels, so the state stays small.
    expect(kept[0]).not.toHaveProperty("text");
    expect(kept[1]).toMatchObject({ text: "b, edited\n" });
  });

  it("comes back with the same note, text, unsaved mark, caret and scroll, without taking the focus", async () => {
    const files = { [A.path]: "# A\n", [B.path]: "b\n" };
    const first = await twoNotes(files);
    const { state } = (await first.host.surfaceState()) as { state: unknown };
    files[A.path] = "# A, newer\n";

    const second = await mount({ handlers: disk(files), restored: state });
    expect(second.view.notes.at(-1)).toEqual({
      ...B,
      name: "b.txt",
      text: "b, edited\n",
      modified: true,
    });
    expect(second.view.places).toEqual([{ start: 3, end: 5, scroll: 40 }]);
    expect(second.view.focused).toBe(0);
    // The saved note is read from disk again; the unsaved one is not, and nothing is watched anew.
    expect(second.params("fs.read")).toEqual([
      { path: A.path, encoding: "utf8", scope: NOTES_READ },
    ]);
    expect(second.params("fs.watch")).toEqual([]);
    // The desk already shows B as unsaved: notes does not say so again.
    expect(second.ran("desk.buffers.update")).toEqual([]);

    await second.host.command("desk.buffers.show", A);
    expect(second.view.notes.at(-1)).toMatchObject({ ...A, text: "# A, newer\n", modified: false });
  });

  it("keeps following the files it watched before it was unloaded", async () => {
    const files = { [A.path]: "# A\n", [B.path]: "b\n" };
    const first = await twoNotes(files);
    const { state } = (await first.host.surfaceState()) as { state: unknown };
    const watched = first.params("fs.watch").length;
    expect(watched).toBe(2);

    const second = await mount({ handlers: disk(files), restored: state });
    second.host.emit({
      event: "fs.changed",
      data: { watchId: "w2", path: B.path, change: "modified" },
    });
    await second.settle();
    expect(second.ran("desk.files.changed")).toEqual([{ path: B.path }]);
  });

  it("starts empty from a state it cannot read, and skips a note gone from disk", async () => {
    const empty = await mount({ handlers: disk({}), restored: "not a notes state" });
    expect(empty.view.notes.at(-1)).toBeNull();

    const files = { [A.path]: "# A\n", [B.path]: "b\n" };
    const first = await twoNotes(files);
    const { state } = (await first.host.surfaceState()) as { state: unknown };
    delete files[A.path];
    const second = await mount({ handlers: disk(files), restored: state });
    expect(second.view.notes.at(-1)).toMatchObject({ buffer: B.buffer, text: "b, edited\n" });
    await expect(second.host.command("desk.buffers.show", A)).rejects.toThrow(/No note/);
  });
});
