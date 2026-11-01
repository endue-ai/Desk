import { describe, expect, it } from "vitest";
import { disk, type Handlers, mount, NOTES_READ, NOTES_WRITE, note } from "./harness";

const A = note("~/Notes/a.md");
const B = note("~/Notes/b.txt");

describe("the desk's file requests", () => {
  it("visit reads the file into the buffer and watches it", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: "# A\n" }) });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    expect(host.calls.filter((c) => c.method.startsWith("fs.")).map((c) => c.method)).toEqual([
      "fs.read",
      "fs.watch",
    ]);
    expect(params("fs.read")).toEqual([{ path: A.path, encoding: "utf8", scope: NOTES_READ }]);
    expect(params("fs.watch")).toEqual([{ path: A.path, scope: NOTES_READ }]);
    expect(view.notes.at(-1)).toEqual({ ...A, name: "a.md", text: "# A\n", modified: false });
    expect(view.focused).toBe(1);
    expect(view.statuses).toEqual([]);
  });

  it("save writes the text and clears the modified mark", async () => {
    const files = { [A.path]: "# A\n" };
    const { host, view, app, params, ran, settle } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);

    app.edit("# A\nmore\n");
    await settle();
    expect(view.notes.at(-1)).toMatchObject({ buffer: A.buffer, modified: true });
    expect(ran("desk.buffers.update")).toEqual([{ id: A.buffer, modified: true }]);
    app.edit("# A\nmore!\n");
    await settle();
    expect(ran("desk.buffers.update")).toHaveLength(1);

    await expect(host.command("desk.files.save", A)).resolves.toBeUndefined();
    expect(params("fs.write")).toEqual([
      { path: A.path, content: "# A\nmore!\n", encoding: "utf8", scope: NOTES_WRITE },
    ]);
    expect(files[A.path]).toBe("# A\nmore!\n");
    expect(view.notes.at(-1)).toMatchObject({ text: "# A\nmore!\n", modified: false });
    await settle();
    expect(ran("desk.buffers.update")).toEqual([{ id: A.buffer, modified: true }]);

    app.edit("# A\nagain\n");
    await settle();
    expect(view.notes.at(-1)).toMatchObject({ text: "# A\nagain\n", modified: true });
    expect(ran("desk.buffers.update")).toEqual([
      { id: A.buffer, modified: true },
      { id: A.buffer, modified: true },
    ]);
  });

  it("text typed while a save is written stays unsaved", async () => {
    const files = { [A.path]: "# A\n" };
    let typing = () => {};
    const handlers: Handlers = {
      ...disk(files),
      "fs.write": ({ path, content }) => {
        typing();
        files[path] = content;
        return { bytesWritten: content.length };
      },
    };
    const { host, view, app, ran, settle } = await mount({ handlers });
    await host.command("desk.files.visit", A);
    app.edit("one\n");
    typing = () => app.edit("one, two\n");

    await host.command("desk.files.save", A);
    await settle();
    expect(files[A.path]).toBe("one\n");
    expect(view.notes.at(-1)).toMatchObject({ text: "one, two\n", modified: true });
    // The desk cleared its mark after the save; it hears once more that the note is unsaved.
    expect(ran("desk.buffers.update")).toEqual([
      { id: A.buffer, modified: true },
      { id: A.buffer, modified: true },
    ]);
  });

  it("revert reloads the file from disk", async () => {
    const files = { [A.path]: "# A\n" };
    const { host, view, app, params, settle } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    app.edit("# A, edited\n");
    await settle();
    files[A.path] = "# A, on disk\n";

    await expect(host.command("desk.files.revert", A)).resolves.toBeUndefined();
    expect(params("fs.read")).toHaveLength(2);
    expect(view.notes.at(-1)).toEqual({
      ...A,
      name: "a.md",
      text: "# A, on disk\n",
      modified: false,
    });
  });

  it("show switches between open notes and closed forgets one", async () => {
    const files = { [A.path]: "# A\n", [B.path]: "b\n" };
    const { host, view, params } = await mount({ handlers: disk(files) });
    expect(view.notes.at(-1)).toBeNull();
    await host.command("desk.files.visit", A);
    await host.command("desk.files.visit", B);
    expect(view.notes.at(-1)).toMatchObject({ buffer: B.buffer, name: "b.txt", text: "b\n" });

    await expect(host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(view.notes.at(-1)).toEqual({ ...A, name: "a.md", text: "# A\n", modified: false });
    expect(view.focused).toBe(3);

    await host.command("desk.buffers.closed", { buffer: A.buffer });
    expect(view.notes.at(-1)).toBeNull();
    await expect(host.command("desk.files.save", A)).rejects.toThrow(`No note ${A.buffer}.`);
    await expect(host.command("desk.buffers.show", A)).rejects.toThrow(`No note ${A.buffer}.`);
    expect(params("fs.write")).toEqual([]);

    await host.command("desk.buffers.show", B);
    expect(view.notes.at(-1)).toMatchObject({ buffer: B.buffer, text: "b\n" });
  });
});
