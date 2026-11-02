// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { denied, disk, file, mount, readScope } from "./harness";
import { pptx, title } from "./pptx";

const A = file("~/Decks/a.pptx");
const B = file("~/Decks/b.pptx");
const DECKS = readScope("~/Decks");
const deckA = pptx([{ shapes: title("Alpha") }]);
const deckB = pptx([{ shapes: title("Beta") }, { shapes: title("Gamma") }]);

const titles = (shown: unknown) => {
  const model = shown as { opened?: { kind: string; deck?: { slides: Array<{ title: string }> } } };
  return model?.opened?.deck?.slides.map((s) => s.title);
};

describe("the desk's file requests", () => {
  it("visit reads the file in ranges from its folder, shows the deck and watches the file", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: deckA }) });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    // Without fs.url (the test host has none), readBytes asks fs.read for the size, then the bytes.
    expect(host.calls.map((c) => c.method)).toEqual(["fs.url", "fs.read", "fs.read", "fs.watch"]);
    expect(params("fs.read")).toEqual([
      { path: A.path, encoding: "base64", offset: 0, length: 0, scope: DECKS },
      { path: A.path, encoding: "base64", offset: 0, length: deckA.length, scope: DECKS },
    ]);
    expect(params("fs.watch")).toEqual([{ path: A.path, scope: DECKS }]);
    expect(view.shown.at(-1)).toMatchObject({
      ...A,
      name: "a.pptx",
      size: deckA.length,
      opened: { kind: "deck" },
    });
    expect(titles(view.shown.at(-1))).toEqual(["Alpha"]);
    expect(view.focused).toBe(1);
  });

  it("revert reads the file again", async () => {
    const files = { [A.path]: deckA };
    const { host, view, params } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    files[A.path] = deckB;
    await expect(host.command("desk.files.revert", A)).resolves.toBeUndefined();
    expect(params("fs.read")).toHaveLength(4);
    expect(titles(view.shown.at(-1))).toEqual(["Beta", "Gamma"]);
  });

  it("show switches between open files and closed forgets one", async () => {
    const { host, view } = await mount({ handlers: disk({ [A.path]: deckA, [B.path]: deckB }) });
    expect(view.shown.at(-1)).toBeNull();
    await host.command("desk.files.visit", A);
    await host.command("desk.files.visit", B);
    expect(titles(view.shown.at(-1))).toEqual(["Beta", "Gamma"]);
    await expect(host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(titles(view.shown.at(-1))).toEqual(["Alpha"]);
    await host.command("desk.buffers.closed", { buffer: A.buffer });
    expect(view.shown.at(-1)).toBeNull();
    await expect(host.command("desk.buffers.show", A)).rejects.toThrow(
      `No presentation ${A.buffer}.`,
    );
    await host.command("desk.buffers.show", B);
    expect(titles(view.shown.at(-1))).toEqual(["Beta", "Gamma"]);
  });

  it("save is refused: slides opens files read-only", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: deckA }) });
    await host.command("desk.files.visit", A);
    await expect(host.command("desk.files.save", A)).rejects.toThrow(
      "Slides opens files read-only.",
    );
    expect(params("fs.write")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Slides opens files read-only.");
  });

  it("a damaged file opens as the details view, not as an error", async () => {
    const broken = new TextEncoder().encode("PK\u0003\u0004 broken");
    const { host, view } = await mount({ handlers: disk({ [A.path]: broken }) });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    expect(view.shown.at(-1)).toMatchObject({ name: "a.pptx", opened: { kind: "details" } });
  });

  it("a change on disk runs desk.files.changed with the path", async () => {
    const { host, ran, settle } = await mount({ handlers: disk({ [A.path]: deckA }) });
    await host.command("desk.files.visit", A);
    host.emit({ event: "fs.changed", data: { watchId: "w1", path: A.path, change: "modified" } });
    await settle();
    expect(ran("desk.files.changed")).toEqual([{ path: A.path }]);
    await host.command("desk.buffers.closed", { buffer: A.buffer });
    host.emit({ event: "fs.changed", data: { watchId: "w1", path: A.path, change: "modified" } });
    await settle();
    expect(ran("desk.files.changed")).toHaveLength(1);
  });
});

describe("files outside the grants", () => {
  const X = file("~/Documents/x.pptx");
  const DOCS = readScope("~/Documents");

  it("a refused read asks once for the folder and reports a refusal in words", async () => {
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": () => {
          throw denied("fs:read over ~/Documents/x.pptx");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(host.command("desk.files.visit", X)).rejects.toThrow(
      "Not allowed to read ~/Documents/x.pptx.",
    );
    expect(params("perm.request")).toEqual([
      { permission: DOCS, reason: "To open ~/Documents/x.pptx in Slides" },
    ]);
    expect(params("fs.read")).toHaveLength(1);
    expect(params("fs.watch")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Not allowed to read ~/Documents/x.pptx.");
    expect(view.shown.at(-1)).toBeNull();
  });

  it("a granted ask reads again", async () => {
    let reads = 0;
    const files = disk({ [X.path]: deckA });
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": (params, caller) => {
          reads++;
          if (reads === 1) throw denied("fs:read over ~/Documents/x.pptx");
          return files["fs.read"]?.(params, caller) as never;
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
        "fs.watch": () => ({ watchId: "w1" }),
      },
    });
    await expect(host.command("desk.files.visit", X)).resolves.toBeUndefined();
    const read = { path: X.path, encoding: "base64", offset: 0, scope: DOCS };
    expect(params("fs.read")).toEqual([
      { ...read, length: 0 },
      { ...read, length: 0 },
      { ...read, length: deckA.length },
    ]);
    expect(params("perm.request")).toHaveLength(1);
    expect(titles(view.shown.at(-1))).toEqual(["Alpha"]);
  });
});
