import { describe, expect, it } from "vitest";
import { cbz } from "./build/comics";
import { denied, disk, file, folderScope, mount } from "./harness";

const A = file("~/Comics/a.cbz");
const B = file("~/Comics/b.cbz");
const JUNK = file("~/Comics/broken.cbz");

describe("the desk's file requests", () => {
  it("visit reads the file as base64, opens it and watches it", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: cbz() }) });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    expect(host.calls.map((c) => c.method)).toEqual(
      expect.arrayContaining(["fs.read", "fs.watch", "store.get"]),
    );
    expect(params("fs.read")).toEqual([
      { path: A.path, encoding: "base64", scope: folderScope(A.path) },
    ]);
    expect(params("fs.watch")).toEqual([{ path: A.path, scope: folderScope(A.path) }]);
    const shown = view.shown.at(-1);
    expect(shown).toMatchObject({ buffer: A.buffer, path: A.path, name: "a.cbz" });
    expect(shown?.book).toMatchObject({ kind: "pages", format: "CBZ comic" });
    expect(shown?.book.pages).toHaveLength(3);
    expect(view.focused).toBeGreaterThan(0);
  });

  it("a file it cannot read opens as a details view, not an error", async () => {
    const junk = new TextEncoder().encode("PK\u0003\u0004 not really a zip");
    const { host, view } = await mount({ handlers: disk({ [JUNK.path]: junk }) });
    await expect(host.command("desk.files.visit", JUNK)).resolves.toBeUndefined();
    const book = view.shown.at(-1)?.book;
    expect(book).toMatchObject({ kind: "details", name: "broken.cbz", size: junk.length });
    expect(book?.kind === "details" && book.why).toMatch(/damaged|cannot/i);
  });

  it("revert reads the file again; show switches between files; closed forgets one", async () => {
    const files = { [A.path]: cbz(), [B.path]: cbz() };
    const { host, view, params } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    await host.command("desk.files.visit", B);
    expect(view.shown.at(-1)).toMatchObject({ buffer: B.buffer });

    await expect(host.command("desk.files.revert", A)).resolves.toBeUndefined();
    expect(params("fs.read")).toHaveLength(3);

    await expect(host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.cbz" });

    await host.command("desk.buffers.closed", A);
    expect(view.shown.at(-1)).toBeNull();
    await expect(host.command("desk.buffers.show", A)).rejects.toThrow(`No file ${A.buffer}.`);
    await host.command("desk.buffers.show", B);
    expect(view.shown.at(-1)).toMatchObject({ buffer: B.buffer });
  });

  it("save is refused: the reader never writes the file", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: cbz() }) });
    await host.command("desk.files.visit", A);
    await expect(host.command("desk.files.save", A)).rejects.toThrow(
      "Reader opens files read-only.",
    );
    expect(params("fs.write")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Reader opens files read-only.");
  });

  it("a refused read asks once for the file's folder and says so in words", async () => {
    const X = file("~/Documents/x.pdf");
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": () => {
          throw denied("fs:read over ~/Documents/x.pdf");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(host.command("desk.files.visit", X)).rejects.toThrow(
      "Not allowed to read ~/Documents/x.pdf.",
    );
    expect(params("perm.request")).toEqual([
      { permission: folderScope(X.path), reason: "To open ~/Documents/x.pdf in Reader" },
    ]);
    expect(params("fs.read")).toHaveLength(1);
    expect(params("fs.watch")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Not allowed to read ~/Documents/x.pdf.");
  });

  it("a granted ask reads again and opens the file", async () => {
    const X = file("~/Documents/x.cbz");
    let reads = 0;
    const handlers = disk({ [X.path]: cbz() });
    const read = handlers["fs.read"];
    const { host, view, params } = await mount({
      handlers: {
        ...handlers,
        "fs.read": (p, caller) => {
          reads++;
          if (reads === 1) throw denied("fs:read over ~/Documents/x.cbz");
          return read?.(p, caller);
        },
        "perm.request": ({ permission }) => ({
          granted: true,
          grant: {
            grantId: "g1",
            permission,
            duration: "session",
            grantedAt: "2026-11-01T09:00:00Z",
          },
        }),
      },
    });
    await expect(host.command("desk.files.visit", X)).resolves.toBeUndefined();
    expect(params("fs.read")).toHaveLength(2);
    expect(params("perm.request")).toHaveLength(1);
    expect(view.shown.at(-1)?.book).toMatchObject({ kind: "pages" });
  });

  it("a change on disk runs desk.files.changed with the path", async () => {
    const { host, ran, settle } = await mount({ handlers: disk({ [A.path]: cbz() }) });
    await host.command("desk.files.visit", A);
    host.emit({ event: "fs.changed", data: { watchId: "w1", path: A.path, change: "modified" } });
    await settle();
    expect(ran("desk.files.changed")).toEqual([{ path: A.path }]);
  });
});
