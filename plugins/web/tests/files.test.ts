// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { denied, disk, file, folder, mount, ranged } from "./harness";

const A = file("~/Sites/a.html");
const B = file("~/Saved/b.url");
const X = file("~/Documents/x.html");
const SITES = folder("~/Sites");
const DOCS = folder("~/Documents");
const PAGE = "<!doctype html><title>A</title><p>Hello</p>";
const LINK = "[InternetShortcut]\r\nURL=https://example.com/\r\n";

describe("the desk's file requests", () => {
  it("visit reads the file in ranges in its folder, shows it and watches it", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: PAGE }) });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    // No URL from this desk: readBytes falls back to ranged fs.read calls.
    expect(host.calls.map((c) => c.method)).toEqual(["fs.url", "fs.read", "fs.read", "fs.watch"]);
    expect(params("fs.url")).toEqual([{ path: A.path, scope: SITES }]);
    expect(params("fs.read")).toEqual(ranged(A.path, SITES, PAGE.length));
    expect(params("fs.watch")).toEqual([{ path: A.path, scope: SITES }]);
    expect(view.shown.at(-1)).toMatchObject({
      ...A,
      name: "a.html",
      size: PAGE.length,
      model: { kind: "page", format: "HTML page", source: PAGE },
    });
    expect(view.focused).toBe(1);
    expect(view.statuses).toEqual([]);
  });

  it("revert reads the file again", async () => {
    const files: Record<string, string> = { [A.path]: PAGE };
    const { host, view, params } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    files[A.path] = "<p>Changed</p>";
    await expect(host.command("desk.files.revert", A)).resolves.toBeUndefined();
    expect(params("fs.url")).toHaveLength(2);
    expect(view.shown.at(-1)).toMatchObject({ ...A, model: { source: "<p>Changed</p>" } });
  });

  it("show switches between open files and closed forgets one", async () => {
    const { host, view } = await mount({ handlers: disk({ [A.path]: PAGE, [B.path]: LINK }) });
    expect(view.shown.at(-1)).toBeNull();
    await host.command("desk.files.visit", A);
    await host.command("desk.files.visit", B);
    expect(view.shown.at(-1)).toMatchObject({ ...B, model: { kind: "card" } });

    await expect(host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(view.shown.at(-1)).toMatchObject({ ...A, model: { kind: "page" } });
    expect(view.focused).toBe(3);

    await host.command("desk.buffers.closed", { buffer: A.buffer });
    expect(view.shown.at(-1)).toBeNull();
    await expect(host.command("desk.buffers.show", A)).rejects.toThrow(`No file ${A.buffer}.`);
    await host.command("desk.buffers.show", B);
    expect(view.shown.at(-1)).toMatchObject({ ...B, model: { kind: "card" } });
  });

  it("save is refused: the plugin opens files read-only", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: PAGE }) });
    await host.command("desk.files.visit", A);
    await expect(host.command("desk.files.save", A)).rejects.toThrow("Web opens files read-only.");
    expect(params("fs.write")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Web opens files read-only.");
  });

  it("a change on disk runs desk.files.changed with the path", async () => {
    const { host, ran, settle } = await mount({ handlers: disk({ [A.path]: PAGE }) });
    await host.command("desk.files.visit", A);
    host.emit({ event: "fs.changed", data: { watchId: "w1", path: A.path, change: "modified" } });
    await settle();
    expect(ran("desk.files.changed")).toEqual([{ path: A.path }]);
  });

  it("a damaged file opens as its details, not as an error", async () => {
    const broken = file("~/Sites/broken.webarchive");
    const { host, view } = await mount({ handlers: disk({ [broken.path]: "bplist00 broken" }) });
    await expect(host.command("desk.files.visit", broken)).resolves.toBeUndefined();
    expect(view.shown.at(-1)).toMatchObject({
      ...broken,
      name: "broken.webarchive",
      size: 15,
      model: { kind: "details", format: "Safari web archive" },
    });
    const model = view.shown.at(-1)?.model as { reason: string };
    expect(model.reason).toMatch(/^[A-Z].*\.$/);
  });
});

describe("files outside the grants", () => {
  it("a refused read asks for the file's folder once and is reported in words", async () => {
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": () => {
          throw denied("fs:read over ~/Documents/x.html");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(host.command("desk.files.visit", X)).rejects.toThrow(
      "Not allowed to read ~/Documents/x.html.",
    );
    expect(params("perm.request")).toEqual([
      { permission: DOCS, reason: "To open ~/Documents/x.html in Web" },
    ]);
    expect(params("fs.read")).toEqual(ranged(X.path, DOCS, 0));
    expect(params("fs.watch")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Not allowed to read ~/Documents/x.html.");
    expect(view.shown.at(-1)).toBeNull();
  });

  it("a granted ask reads again", async () => {
    let reads = 0;
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": ({ offset = 0, length }) => {
          reads++;
          if (reads === 1) throw denied("fs:read over ~/Documents/x.html");
          const bytes = Buffer.from(PAGE).subarray(
            offset,
            length === undefined ? undefined : offset + length,
          );
          return { content: bytes.toString("base64"), encoding: "base64", size: PAGE.length };
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
    expect(params("fs.read")).toEqual([
      ...ranged(X.path, DOCS, 0),
      ...ranged(X.path, DOCS, PAGE.length),
    ]);
    expect(params("perm.request")).toHaveLength(1);
    expect(view.shown.at(-1)).toMatchObject({ ...X, model: { kind: "page" } });
  });
});
