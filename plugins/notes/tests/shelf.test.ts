import { describe, expect, it, vi } from "vitest";
import { createLibrary } from "../ui/library.js";
import { autosaves, createShelf, fileNameOf, type Shelved } from "../ui/shelf.js";
import { disk, type Mounted, mount, NOTES_READ, NOTES_WRITE, note } from "./harness";

/** A recording shelf view. */
function shelfView() {
  const lists: Array<{ items: Shelved[]; current: string | undefined; filter: string }> = [];
  const confirms: boolean[] = [];
  return {
    lists,
    confirms,
    list: (items: Shelved[], current: string | undefined, filter: string) =>
      lists.push({ items, current, filter }),
    confirming: (on: boolean) => confirms.push(on),
  };
}

/** Notes over a disk with the shelf beside it, desk.files.open visiting the file as the desk does. */
async function shelved(files: Record<string, string>, times: Record<string, string> = {}) {
  let m: Mounted | undefined;
  m = await mount({
    handlers: {
      ...disk(files, { times }),
      "fs.rename": ({ from, to }) => {
        files[to] = files[from] ?? "";
        delete files[from];
        return { crossedDevices: false };
      },
      "fs.trash": ({ path }) => {
        delete files[path];
        return {};
      },
    },
    commands: {
      "desk.files.open": async (args) => {
        const { path } = args as { path: string };
        await m?.host.command("desk.files.visit", note(path));
        return note(path).buffer;
      },
      "desk.buffers.close": async (args) => {
        const { id } = args as { id: string };
        await m?.host.command("desk.buffers.closed", { buffer: id });
      },
    },
  });
  const view = shelfView();
  // Timers the test runs by hand: the test host's own settling keeps the real ones.
  const due: Array<() => void> = [];
  const timers = {
    set: ((run: () => void) => due.push(run)) as unknown as typeof setTimeout,
    clear: (() => {}) as typeof clearTimeout,
  };
  const shelf = createShelf(m.ctx, m.app, createLibrary(m.ctx), view, { timers });
  const tick = () => {
    for (const run of due.splice(0)) run();
  };
  return { m, view, shelf, tick };
}

describe("names", () => {
  it("adds .md, keeps .md and .txt, and refuses an empty name", () => {
    expect(fileNameOf(" ideas ")).toBe("ideas.md");
    expect(fileNameOf("todo.txt")).toBe("todo.txt");
    expect(fileNameOf("a/b")).toBe("a-b.md");
    expect(fileNameOf("  ")).toBe("");
  });
  it("auto-saves only notes in ~/Notes", () => {
    expect(autosaves("~/Notes/a.md")).toBe(true);
    expect(autosaves("~/Documents/a.md")).toBe(false);
  });
});

describe("the shelf", () => {
  it("lists ~/Notes newest first, titled by the first line, and narrows by the filter", async () => {
    const { view, shelf, m } = await shelved(
      { "~/Notes/a.md": "# Groceries\nmilk", "~/Notes/b.md": "Meeting notes" },
      { "~/Notes/a.md": "2026-11-01T09:00:00Z", "~/Notes/b.md": "2026-11-02T09:00:00Z" },
    );
    await shelf.refresh();
    expect(view.lists.at(-1)?.items.map((i) => [i.name, i.title])).toEqual([
      ["b.md", "Meeting notes"],
      ["a.md", "Groceries"],
    ]);
    expect(m.params("fs.watch").at(-1)).toEqual({
      path: "~/Notes",
      recursive: true,
      scope: NOTES_READ,
    });
    shelf.filter("groc");
    expect(view.lists.at(-1)?.items.map((i) => i.name)).toEqual(["a.md"]);
  });

  it("saves a note in ~/Notes once typing pauses, and clears the desk's unsaved mark", async () => {
    const files = { "~/Notes/a.md": "one" };
    const { m, shelf, tick } = await shelved(files);
    await m.host.command("desk.files.visit", note("~/Notes/a.md"));
    m.app.edit("one two");
    shelf.typed();
    expect(files["~/Notes/a.md"]).toBe("one");
    tick();
    await vi.waitFor(() => expect(files["~/Notes/a.md"]).toBe("one two"));
    await m.settle();
    expect(m.ran("desk.buffers.update").at(-1)).toEqual({
      id: "file:~/Notes/a.md",
      modified: false,
    });
  });

  it("renames the note on screen, opens it under the new name and closes the old buffer", async () => {
    const files: Record<string, string> = { "~/Notes/a.md": "text" };
    const { m, shelf } = await shelved(files);
    await m.host.command("desk.files.visit", note("~/Notes/a.md"));
    await shelf.rename("ideas");
    expect(m.params("fs.rename")).toEqual([
      { from: "~/Notes/a.md", to: "~/Notes/ideas.md", scope: NOTES_WRITE },
    ]);
    expect(files).toEqual({ "~/Notes/ideas.md": "text" });
    expect(m.app.current()?.path).toBe("~/Notes/ideas.md");
    expect(m.ran("desk.buffers.close")).toEqual([{ id: "file:~/Notes/a.md" }]);
  });

  it("deletes only on the second press, to the Trash", async () => {
    const files: Record<string, string> = { "~/Notes/a.md": "text" };
    const { m, shelf, view } = await shelved(files);
    await m.host.command("desk.files.visit", note("~/Notes/a.md"));
    await shelf.remove();
    expect(view.confirms).toEqual([true]);
    expect(m.params("fs.trash")).toEqual([]);
    expect(files["~/Notes/a.md"]).toBe("text");
    await shelf.remove();
    expect(m.params("fs.trash")).toEqual([{ path: "~/Notes/a.md", scope: NOTES_WRITE }]);
    expect(files).toEqual({});
    expect(m.ran("desk.buffers.close")).toEqual([{ id: "file:~/Notes/a.md" }]);
    expect(m.app.current()).toBeUndefined();
  });
});
