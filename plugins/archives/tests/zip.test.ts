import { describe, expect, it } from "vitest";
import { openArchive } from "../ui/formats/index.js";
import { memorySource } from "../ui/source.js";
import {
  entry,
  expected,
  files,
  fixture,
  noise,
  open,
  read,
  sha256,
  TREE,
  utf8,
  WHEN,
  zipOf,
} from "./fixtures";

describe("ZIP", () => {
  it("lists Info-ZIP's archive: names, sizes, dates, methods, a folder and a link", async () => {
    const zip = await open(fixture("tree.zip"), "tree.zip");
    expect(zip.format).toBe("ZIP");
    expect(files(zip)).toEqual(
      ["data.bin", "docs/readme.md", TREE.koreanName, "hello.txt", "image.png", "link", "words.txt"]
        .slice()
        .sort(),
    );
    expect(entry(zip, "docs")).toMatchObject({ kind: "folder" });
    expect(entry(zip, "hello.txt")).toMatchObject({ kind: "file", size: 17, packed: 17 });
    expect(entry(zip, "hello.txt").method).toBe("Stored");
    expect(entry(zip, "words.txt")).toMatchObject({ size: 48069, method: "Deflate" });
    expect(entry(zip, "words.txt").packed).toBeLessThan(20000);
    expect(entry(zip, "link")).toMatchObject({ kind: "link", link: "hello.txt" });
    expect(entry(zip, "hello.txt").date?.toISOString()).toBe(WHEN);
  });

  it("extracts stored and deflated entries to the original bytes", async () => {
    const zip = await open(fixture("tree.zip"), "tree.zip");
    expect(await read(zip, "hello.txt")).toBe(TREE.hello);
    expect(await read(zip, TREE.koreanName)).toBe(TREE.korean);
    expect(sha256(await zip.read(entry(zip, "words.txt")))).toBe(expected.words.sha256);
    const data = await zip.read(entry(zip, "data.bin"));
    expect(data.length).toBe(4096);
    expect([...data.subarray(250, 260)]).toEqual([250, 251, 252, 253, 254, 255, 0, 1, 2, 3]);
  });

  it("reads every method: store, deflate, bzip2, LZMA, zstd and xz", async () => {
    const zip = await open(fixture("methods.zip"), "methods.zip");
    const methods = Object.fromEntries(zip.entries.map((e) => [e.path, e.method]));
    expect(methods).toMatchObject({
      "stored.txt": "Stored",
      "deflate.txt": "Deflate",
      "bzip2.txt": "bzip2",
      "lzma.txt": "LZMA",
      "zstd.txt": "Zstandard",
      "xz.txt": "xz",
    });
    for (const name of ["deflate.txt", "bzip2.txt", "lzma.txt", "zstd.txt", "xz.txt"])
      expect(sha256(await zip.read(entry(zip, name))), name).toBe(expected.words.sha256);
    expect(await read(zip, "stored.txt")).toBe(TREE.hello);
  });

  it("decodes a name without the UTF-8 flag as CP437", async () => {
    const zip = await open(fixture("methods.zip"), "methods.zip");
    expect(files(zip)).toContain("café.txt");
    expect(await read(zip, "café.txt")).toBe("CP437 names\n");
  });

  it("reads ZIP64 end records and extra fields", async () => {
    const zip = await open(fixture("zip64.zip"), "zip64.zip");
    expect(files(zip)).toEqual(["hello.txt"]);
    expect(entry(zip, "hello.txt")).toMatchObject({ size: 17 });
    expect(await read(zip, "hello.txt")).toBe(TREE.hello);
  });

  it("marks encrypted entries and does not extract them", async () => {
    const zip = await open(fixture("encrypted.zip"), "encrypted.zip");
    expect(files(zip)).toEqual(["docs/readme.md", "hello.txt"]);
    expect(zip.entries.filter((e) => e.kind === "file").every((e) => e.encrypted)).toBe(true);
    await expect(zip.read(entry(zip, "hello.txt"))).rejects.toThrow("Encrypted: not extracted.");
  });

  it("finds the directory from the end in a few ranged reads, entries only when read", async () => {
    const bytes = zipOf([
      { name: "hello.txt", data: TREE.hello },
      { name: "big.bin", data: noise(400_000) },
      { name: "docs/a.md", data: "# A\n", deflate: true },
    ]);
    const memory = memorySource(bytes);
    const reads: Array<[number, number]> = [];
    const source = {
      size: memory.size,
      read: (offset: number, length: number) => {
        reads.push([offset, length]);
        return memory.read(offset, length);
      },
    };
    const zip = await openArchive(source, "big.zip");
    expect(files(zip)).toEqual(["big.bin", "docs/a.md", "hello.txt"]);
    const listed = reads.reduce((n, [, length]) => n + length, 0);
    expect(listed).toBeLessThan(80_000);
    expect(reads.every(([offset, length]) => offset + length <= bytes.length)).toBe(true);

    reads.length = 0;
    expect(utf8(await zip.read(entry(zip, "docs/a.md")))).toBe("# A\n");
    expect(reads.reduce((n, [, length]) => n + length, 0)).toBeLessThan(80_000);
  });

  it("a ZIP without its end record fails with a sentence", async () => {
    const bytes = fixture("tree.zip").subarray(0, 600);
    await expect(open(bytes, "cut.zip")).rejects.toThrow(/^[A-Z][^\n]*\.$/);
  });
});
