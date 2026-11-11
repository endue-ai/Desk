// The desk puts a notes window nobody sees to sleep and loads it again when it shows (ADR 0070, ADR
// XXXX): notes answers ui.surface.state through the SDK's keepFiles and comes back from
// ctx.surface.restored as it was: its notes, their unsaved text, the caret and the scroll.
import { describe, expect, it } from "vitest";
import { STATE_LIMIT } from "../../../packages/plugin-sdk/src/surface-state";
import { denied, disk, mount, NOTES_READ, note } from "./harness";

const A = note("~/Notes/a.md");
const B = note("~/Notes/b.txt");
const LONG = note("~/Notes/long.md");

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

/** What a note says the size of a state is, as the desk measures it. */
const bytes = (state: unknown) => new TextEncoder().encode(JSON.stringify(state)).length;

/** A 114 KB note, as the QA pass edited one. */
const long = `# Long note\n\n${"the desk keeps what a person was doing while a window sleeps\n".repeat(1900)}`;

describe("put to sleep while hidden, and back", () => {
  it("answers ui.surface.state with the notes it holds, the unsaved text only, and where the caret is", async () => {
    const first = await twoNotes({ [A.path]: "# A\n", [B.path]: "b\n" });
    const { state } = (await first.host.surfaceState()) as { state: Record<string, unknown> };
    expect(state).toEqual({
      v: 1,
      files: [
        { ...A, place: { watchId: "w1" } },
        {
          ...B,
          place: { watchId: "w2", caret: [3, 5], scroll: 40 },
          // Saved text is on disk already: only unsaved text travels, so the state stays small.
          edit: { text: "b, edited\n", reported: true },
        },
      ],
      shown: B.buffer,
    });
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
    // Both are read without asking: the saved note for its text, the unsaved one for what it was
    // saved as, which its next sleep keeps a change from. Nothing is watched anew.
    expect(second.params("fs.read")).toEqual([
      { path: A.path, encoding: "utf8", scope: NOTES_READ },
      { path: B.path, encoding: "utf8", scope: NOTES_READ },
    ]);
    expect(second.params("perm.request")).toEqual([]);
    expect(second.params("fs.watch")).toEqual([]);
    // The desk already shows B as unsaved: notes does not say so again.
    expect(second.ran("desk.buffers.update")).toEqual([]);

    await second.host.command("desk.buffers.show", A);
    expect(second.view.notes.at(-1)).toMatchObject({ ...A, text: "# A, newer\n", modified: false });
  });

  it("keeps following the files it watched before it slept", async () => {
    const files = { [A.path]: "# A\n", [B.path]: "b\n" };
    const first = await twoNotes(files);
    const { state } = (await first.host.surfaceState()) as { state: unknown };
    expect(first.params("fs.watch")).toHaveLength(2);

    const second = await mount({ handlers: disk(files), restored: state });
    second.host.emit({
      event: "fs.changed",
      data: { watchId: "w2", path: B.path, change: "modified" },
    });
    await second.settle();
    expect(second.ran("desk.files.changed")).toEqual([{ path: B.path }]);
  });

  it("a 114 KB note with a typed word and a small unsaved note both come back whole (#162)", async () => {
    const files = { [LONG.path]: long, [A.path]: "# A\n" };
    const first = await mount({ handlers: disk(files) });
    await first.host.command("desk.files.visit", A);
    first.app.edit("# A, edited\n");
    await first.host.command("desk.files.visit", LONG);
    const typed = `${long.slice(0, 40)} UNSAVED-LONG${long.slice(40)}`;
    first.app.edit(typed);
    await first.settle();
    first.view.at = { start: 53, end: 53, scroll: 0 };
    expect(long.length).toBeGreaterThan(110_000);

    const { state } = (await first.host.surfaceState()) as { state: unknown };
    expect(bytes(state)).toBeLessThanOrEqual(STATE_LIMIT);

    const second = await mount({ handlers: disk(files), restored: state });
    expect(second.view.notes.at(-1)).toEqual({
      ...LONG,
      name: "long.md",
      text: typed,
      modified: true,
    });
    expect(second.view.places).toEqual([{ start: 53, end: 53, scroll: 0 }]);
    await second.host.command("desk.buffers.show", A);
    expect(second.view.notes.at(-1)).toMatchObject({ text: "# A, edited\n", modified: true });
    // Saved, the long note writes exactly what was typed.
    await second.host.command("desk.files.save", LONG);
    expect(files[LONG.path]).toBe(typed);
  });

  it("says so when an unsaved change cannot be put back: the file changed on disk while it slept", async () => {
    const files = { [LONG.path]: long };
    const first = await mount({ handlers: disk(files) });
    await first.host.command("desk.files.visit", LONG);
    first.app.edit(`${long} and more`);
    await first.settle();
    const { state } = (await first.host.surfaceState()) as { state: unknown };
    files[LONG.path] = `${long}, changed elsewhere`;

    const second = await mount({ handlers: disk(files), restored: state });
    expect(second.view.notes.at(-1)).toMatchObject({
      text: `${long}, changed elsewhere`,
      modified: false,
    });
    // The desk's unsaved mark goes, and the status line says what happened until the person types.
    expect(second.ran("desk.buffers.update")).toEqual([{ id: LONG.buffer, modified: false }]);
    const lost = "The unsaved changes to long.md could not be kept while its window slept.";
    expect(second.view.statuses.at(-1)).toBe(lost);
    await second.host.command("desk.buffers.show", LONG);
    expect(second.view.statuses.at(-1)).toBe(lost);
    second.app.edit("typed again");
    expect(second.view.statuses.at(-1)).toBe("");
  });

  it("opens again on show a note the desk lists that its page lost, from disk", async () => {
    const files = { [A.path]: "# A\n" };
    // A page that loaded again without a kept state (a crash, say) holds nothing.
    const cold = await mount({ handlers: disk(files) });
    await cold.host.command("desk.buffers.show", A);
    expect(cold.view.notes.at(-1)).toMatchObject({ ...A, text: "# A\n", modified: false });
    expect(cold.ran("desk.buffers.update")).toEqual([{ id: A.buffer, modified: false }]);
    expect(cold.view.statuses.at(-1)).toBe("a.md was opened again from disk.");
    // And it follows the file on disk again.
    expect(cold.params("fs.watch")).toHaveLength(1);
  });

  it("keeps a note it could not read as it woke, and reads it, asking, when it is shown", async () => {
    const files = { [A.path]: "# A\n", [B.path]: "b\n" };
    const first = await twoNotes(files);
    const { state } = (await first.host.surfaceState()) as { state: unknown };
    let allowed = false;
    const second = await mount({
      handlers: {
        ...disk(files),
        "fs.read": ({ path }) => {
          if (!allowed && path === A.path) throw denied(`fs:read over ${path}`);
          return { content: files[path] ?? "", encoding: "utf8" };
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
    expect(second.params("perm.request")).toEqual([]);
    // Asleep again before it was shown, A is still kept.
    const { state: again } = (await second.host.surfaceState()) as {
      state: { files: Array<{ path: string }> };
    };
    expect(again.files.map((f) => f.path)).toEqual([A.path, B.path]);
    await second.host.command("desk.buffers.show", A);
    expect(second.params("perm.request")).toHaveLength(1);
    expect(second.view.notes.at(-1)).toMatchObject({ ...A, text: "# A\n" });
  });

  it("starts empty from a state it cannot read, and a note gone from disk fails in words", async () => {
    const empty = await mount({ handlers: disk({}), restored: "not a notes state" });
    expect(empty.view.notes.at(-1)).toBeNull();

    const files = { [A.path]: "# A\n", [B.path]: "b\n" };
    const first = await twoNotes(files);
    const { state } = (await first.host.surfaceState()) as { state: unknown };
    delete files[A.path];
    const second = await mount({ handlers: disk(files), restored: state });
    expect(second.view.notes.at(-1)).toMatchObject({ buffer: B.buffer, text: "b, edited\n" });
    await expect(second.host.command("desk.buffers.show", A)).rejects.toThrow(
      `Could not read ${A.path}: not_found.`,
    );
  });
});
