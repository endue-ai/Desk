import { describe, expect, it } from "vitest";
import { noise, TREE, zipOf } from "./fixtures";
import { file, mount, READ, rowNames } from "./harness";

const DOWNLOADS = READ("~/Downloads");
const BIG_PATH = "~/Downloads/big.zip";
const BIG = zipOf([
  { name: "hello.txt", data: TREE.hello },
  { name: "big.bin", data: noise(400_000) },
  { name: "docs/a.md", data: "# A\n", deflate: true },
]);
const SMALL_PATH = "~/Downloads/small.zip";
const SMALL = zipOf([{ name: "only.txt", data: "only\n" }]);

type Read = { path: string; encoding?: string; offset?: number; length?: number; scope: unknown };

describe("the desk's file requests", () => {
  it("visit reads a ZIP's directory with ranged fs.read calls, never the whole file", async () => {
    const { host, view, params } = await mount({
      files: { [BIG_PATH]: BIG },
      grants: [DOWNLOADS],
    });
    await expect(host.command("desk.files.visit", file(BIG_PATH))).resolves.toBeUndefined();
    const reads = params("fs.read") as Read[];
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read).toMatchObject({ path: BIG_PATH, encoding: "base64", scope: DOWNLOADS });
      expect(read.length).toBeTypeOf("number");
    }
    const total = reads.reduce((n, r) => n + (r.length ?? 0), 0);
    expect(total).toBeLessThan(BIG.length / 4);
    expect(view.archives.at(-1)).toMatchObject({
      buffer: `file:${BIG_PATH}`,
      path: BIG_PATH,
      name: "big.zip",
      format: "ZIP",
      size: BIG.length,
    });
    expect(rowNames(view)).toEqual(["docs", "big.bin", "hello.txt"]);
    expect(params("fs.watch")).toEqual([{ path: BIG_PATH, scope: DOWNLOADS }]);
    expect(view.focused).toBe(1);
    expect(view.statuses).toEqual([]);
  });

  it("selecting an entry reads only that entry and previews it", async () => {
    const { host, view, app, params, settle } = await mount({
      files: { [BIG_PATH]: BIG },
      grants: [DOWNLOADS],
    });
    await host.command("desk.files.visit", file(BIG_PATH));
    const before = params("fs.read").length;
    await app.select("hello.txt");
    await settle();
    expect(view.previews.at(-1)).toMatchObject({
      kind: "text",
      name: "hello.txt",
      text: TREE.hello,
    });
    const after = (params("fs.read") as Read[]).slice(before);
    expect(after.reduce((n, r) => n + (r.length ?? 0), 0)).toBeLessThan(100_000);
  });

  it("revert reads the archive again", async () => {
    const files: Record<string, Uint8Array> = { [SMALL_PATH]: SMALL };
    const { host, view, params } = await mount({ files, grants: [DOWNLOADS] });
    await host.command("desk.files.visit", file(SMALL_PATH));
    const reads = params("fs.read").length;
    await expect(host.command("desk.files.revert", file(SMALL_PATH))).resolves.toBeUndefined();
    expect(params("fs.read").length).toBeGreaterThan(reads);
    expect(rowNames(view)).toEqual(["only.txt"]);
  });

  it("show switches between open archives and closed forgets one", async () => {
    const { host, view } = await mount({
      files: { [BIG_PATH]: BIG, [SMALL_PATH]: SMALL },
      grants: [DOWNLOADS],
    });
    expect(view.archives.at(-1)).toBeNull();
    await host.command("desk.files.visit", file(BIG_PATH));
    await host.command("desk.files.visit", file(SMALL_PATH));
    expect(view.archives.at(-1)).toMatchObject({ name: "small.zip" });
    await expect(host.command("desk.buffers.show", file(BIG_PATH))).resolves.toBeUndefined();
    expect(view.archives.at(-1)).toMatchObject({ name: "big.zip" });
    await host.command("desk.buffers.closed", { buffer: `file:${BIG_PATH}` });
    expect(view.archives.at(-1)).toBeNull();
    await expect(host.command("desk.buffers.show", file(BIG_PATH))).rejects.toThrow(
      `No archive file:${BIG_PATH}.`,
    );
    await host.command("desk.buffers.show", file(SMALL_PATH));
    expect(view.archives.at(-1)).toMatchObject({ name: "small.zip" });
  });

  it("save is refused: archives open read-only", async () => {
    const { host, view } = await mount({ files: { [SMALL_PATH]: SMALL }, grants: [DOWNLOADS] });
    await host.command("desk.files.visit", file(SMALL_PATH));
    await expect(host.command("desk.files.save", file(SMALL_PATH))).rejects.toThrow(
      "Archives opens files read-only.",
    );
    expect(view.statuses.at(-1)).toBe("Archives opens files read-only.");
  });

  it("a read the grants do not cover asks once for the file's folder and tries again", async () => {
    const path = "~/Documents/x.zip";
    const { host, view, params } = await mount({ files: { [path]: SMALL } });
    await expect(host.command("desk.files.visit", file(path))).resolves.toBeUndefined();
    expect(params("perm.request")).toEqual([
      { permission: READ("~/Documents"), reason: `To open ${path} in Archives` },
    ]);
    expect(rowNames(view)).toEqual(["only.txt"]);
  });

  it("a refusal is said in words, on the status line and in the request's error", async () => {
    const path = "~/Documents/x.zip";
    const { host, view, params } = await mount({ files: { [path]: SMALL }, prompt: () => false });
    await expect(host.command("desk.files.visit", file(path))).rejects.toThrow(
      `Not allowed to read ${path}.`,
    );
    expect(params("perm.request")).toHaveLength(1);
    expect(view.statuses.at(-1)).toBe(`Not allowed to read ${path}.`);
    expect(params("fs.watch")).toEqual([]);
  });

  it("a damaged or unknown file opens as a details view with one sentence", async () => {
    const bad = "~/Downloads/bad.zip";
    const odd = "~/Downloads/odd.zip";
    const { host, view } = await mount({
      files: { [bad]: BIG.subarray(0, 2000), [odd]: noise(3000) },
      grants: [DOWNLOADS],
    });
    await expect(host.command("desk.files.visit", file(bad))).resolves.toBeUndefined();
    expect(view.archives.at(-1)).toMatchObject({ name: "bad.zip", format: "ZIP", rows: [] });
    expect(view.archives.at(-1)?.note).toMatch(/^[A-Z][^\n]*\.$/);
    await host.command("desk.files.visit", file(odd));
    expect(view.archives.at(-1)).toMatchObject({ name: "odd.zip", format: "Unknown", rows: [] });
    expect(view.archives.at(-1)?.note).toMatch(/^[A-Z][^\n]*\.$/);
  });

  it("a change on disk runs desk.files.changed with the path", async () => {
    const { host, ran, settle } = await mount({
      files: { [SMALL_PATH]: SMALL },
      grants: [DOWNLOADS],
    });
    await host.command("desk.files.visit", file(SMALL_PATH));
    host.emit({
      event: "fs.changed",
      data: { watchId: "w1", path: SMALL_PATH, change: "modified" },
    });
    await settle();
    expect(ran("desk.files.changed")).toEqual([{ path: SMALL_PATH }]);
  });

  it("an archive inside the archive opens one level down, and up goes back", async () => {
    const outer = zipOf([
      { name: "inner.zip", data: SMALL },
      { name: "top.txt", data: "top\n" },
    ]);
    const path = "~/Downloads/outer.zip";
    const { host, view, app, settle } = await mount({
      files: { [path]: outer },
      grants: [DOWNLOADS],
    });
    await host.command("desk.files.visit", file(path));
    await app.open("inner.zip");
    await settle();
    expect(view.archives.at(-1)).toMatchObject({ levels: ["outer.zip", "inner.zip"] });
    expect(rowNames(view)).toEqual(["only.txt"]);
    await app.up();
    expect(view.archives.at(-1)).toMatchObject({ levels: ["outer.zip"] });
    expect(rowNames(view)).toEqual(["inner.zip", "top.txt"]);
  });
});
