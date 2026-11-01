import { resolveObjectURL } from "node:buffer";
import { describe, expect, it } from "vitest";
import { pngHeader } from "./build";
import { denied, disk, fixture, folderScope, image, mount } from "./harness";

const A = image("~/Pictures/a.png");
const B = image("~/Pictures/b.jpg");
const X = image("~/Documents/x.png");
const SCOPE = folderScope(A.path);

describe("the desk's file requests", () => {
  it("visit reads the file in ranges, shows it, watches it and lists its folder", async () => {
    const files = { [A.path]: fixture("exif.png") };
    const { host, view, params } = await mount({ handlers: disk(files) });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    // Without a file URL from the desk, the SDK reads ranges through fs.read: the size, then bytes.
    expect(host.calls.map((c) => c.method)).toEqual([
      "fs.url",
      "fs.read",
      "fs.read",
      "fs.watch",
      "fs.list",
    ]);
    const size = files[A.path]?.length;
    expect(params("fs.read")).toEqual([
      { path: A.path, encoding: "base64", scope: SCOPE, offset: 0, length: 0 },
      { path: A.path, encoding: "base64", scope: SCOPE, offset: 0, length: size },
    ]);
    expect(params("fs.watch")).toEqual([{ path: A.path, scope: SCOPE }]);
    expect(params("fs.list")).toEqual([{ path: "~/Pictures", scope: SCOPE }]);
    const shown = view.states.at(-1)?.image;
    expect(shown).toMatchObject({
      buffer: A.buffer,
      path: A.path,
      name: "a.png",
      format: "PNG",
      kind: "web",
      width: 64,
      height: 48,
      size: files[A.path]?.length,
    });
    // The webview decodes the bytes from a blob: URL; nothing goes through base64.
    const blob = resolveObjectURL(shown?.src ?? "");
    expect(blob?.type).toBe("image/png");
    expect(new Uint8Array((await blob?.arrayBuffer()) ?? [])).toEqual(fixture("exif.png"));
    expect(view.states.at(-1)?.position).toEqual({ index: 1, count: 1 });
    expect(view.focused).toBe(1);
    expect(view.statuses).toEqual([]);
  });

  it("revert reads the file again and shows what is on disk now", async () => {
    const files = { [A.path]: pngHeader(10, 20) };
    const { host, view, params } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    expect(view.states.at(-1)?.image).toMatchObject({ width: 10, height: 20 });
    files[A.path] = pngHeader(30, 40);
    await expect(host.command("desk.files.revert", A)).resolves.toBeUndefined();
    expect(params("fs.read")).toHaveLength(4);
    expect(view.states.at(-1)?.image).toMatchObject({ buffer: A.buffer, width: 30, height: 40 });
  });

  it("show switches between open images and closed forgets one", async () => {
    const files = { [A.path]: pngHeader(10, 20), [B.path]: fixture("exif.jpg") };
    const { host, view } = await mount({ handlers: disk(files) });
    expect(view.states.at(-1)?.image ?? null).toBeNull();
    await host.command("desk.files.visit", A);
    await host.command("desk.files.visit", B);
    expect(view.states.at(-1)?.image).toMatchObject({ buffer: B.buffer, format: "JPEG" });

    await expect(host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(view.states.at(-1)?.image).toMatchObject({ buffer: A.buffer, name: "a.png" });
    expect(view.focused).toBe(3);

    await host.command("desk.buffers.closed", { buffer: A.buffer });
    expect(view.states.at(-1)?.image ?? null).toBeNull();
    await expect(host.command("desk.buffers.show", A)).rejects.toThrow(`No image ${A.buffer}.`);
    await host.command("desk.buffers.show", B);
    expect(view.states.at(-1)?.image).toMatchObject({ buffer: B.buffer });
  });

  it("save is refused: images never writes a file", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: pngHeader(1, 1) }) });
    await host.command("desk.files.visit", A);
    await expect(host.command("desk.files.save", A)).rejects.toThrow(
      "Images opens files read-only.",
    );
    expect(params("fs.write")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Images opens files read-only.");
  });

  it("a change on disk runs desk.files.changed with the path", async () => {
    const { host, ran, settle } = await mount({
      handlers: { ...disk({ [A.path]: pngHeader(1, 1) }), "fs.watch": () => ({ watchId: "w1" }) },
    });
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
  const DOCS = folderScope(X.path);

  it("a refused read asks once for the file's folder and says so in words", async () => {
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": () => {
          throw denied("fs:read over ~/Documents/x.png");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(host.command("desk.files.visit", X)).rejects.toThrow(
      "Not allowed to read ~/Documents/x.png.",
    );
    expect(params("perm.request")).toEqual([
      { permission: DOCS, reason: "To open ~/Documents/x.png in Images" },
    ]);
    expect(params("fs.read")).toEqual([
      { path: X.path, encoding: "base64", scope: DOCS, offset: 0, length: 0 },
    ]);
    expect(params("fs.watch")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Not allowed to read ~/Documents/x.png.");
    expect(view.states.at(-1)?.image ?? null).toBeNull();
  });

  it("a granted ask reads the file again and opens it", async () => {
    let reads = 0;
    const files = { [X.path]: pngHeader(4, 3) };
    const { host, view, params } = await mount({
      handlers: {
        ...disk(files),
        "fs.read": ({ path, offset = 0, length }) => {
          reads++;
          if (reads === 1) throw denied(`fs:read over ${path}`);
          const bytes = files[X.path] ?? new Uint8Array();
          const part = bytes.subarray(offset, length === undefined ? undefined : offset + length);
          return {
            content: Buffer.from(part).toString("base64"),
            encoding: "base64",
            size: bytes.length,
          };
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
    const read = { path: X.path, encoding: "base64", scope: DOCS, offset: 0, length: 0 };
    const size = files[X.path]?.length;
    expect(params("fs.read")).toEqual([read, read, { ...read, length: size }]);
    expect(params("perm.request")).toHaveLength(1);
    expect(view.states.at(-1)?.image).toMatchObject({ buffer: X.buffer, width: 4, height: 3 });
  });

  it("other read errors are reported with their code and no ask", async () => {
    const { host, view, params } = await mount({ handlers: disk({}) });
    await expect(host.command("desk.files.visit", A)).rejects.toThrow(
      "Could not read ~/Pictures/a.png: not_found.",
    );
    expect(params("perm.request")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Could not read ~/Pictures/a.png: not_found.");
  });
});
