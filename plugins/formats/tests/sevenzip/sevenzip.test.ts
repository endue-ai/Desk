import { openSevenZip } from "@endue-ai/formats/sevenzip/index.js";
import { describe, expect, it } from "vitest";
import {
  detail,
  entry,
  expected,
  files,
  fixture,
  memorySource,
  open,
  read,
  sha256,
  TREE,
  utf8,
  WHEN,
} from "./helpers";

describe("7z", () => {
  it("reads an encoded header and a solid LZMA2 block", async () => {
    const seven = await open("solid.7z");
    expect(seven.format).toBe("7z");
    expect(detail(seven, "Header")).toBe("Encoded");
    expect(detail(seven, "Solid")).toBe("Yes");
    expect(files(seven)).toEqual(
      ["data.bin", "docs/readme.md", TREE.koreanName, "hello.txt", "words.txt"].sort(),
    );
    expect(entry(seven, "docs")).toMatchObject({ kind: "folder" });
    expect(entry(seven, "words.txt")).toMatchObject({ size: 48069, method: "LZMA2" });
    expect(entry(seven, "hello.txt").date?.toISOString()).toBe(WHEN);
    expect(sha256(await seven.read(entry(seven, "words.txt")))).toBe(expected.words.sha256);
    expect(await read(seven, "hello.txt")).toBe(TREE.hello);
    expect(await read(seven, TREE.koreanName)).toBe(TREE.korean);
  });

  it("reads a plain header and LZMA streams, one per file", async () => {
    const seven = await open("plain.7z");
    expect(detail(seven, "Header")).toBe("Plain");
    expect(detail(seven, "Solid")).toBe("No");
    expect(files(seven)).toEqual(["docs/readme.md", "hello.txt"]);
    expect(entry(seven, "hello.txt").method).toBe("LZMA");
    expect(await read(seven, "docs/readme.md")).toBe(TREE.readme);
  });

  it("undoes the BCJ x86 filter", async () => {
    const seven = await open("bcj.7z");
    expect(entry(seven, "data.bin").method).toBe("BCJ, LZMA2");
    const data = await seven.read(entry(seven, "data.bin"));
    expect(data).toEqual(Uint8Array.from({ length: 4096 }, (_, i) => i & 0xff));
    expect(sha256(await seven.read(entry(seven, "words.txt")))).toBe(expected.words.sha256);
  });

  it("reads copied streams", async () => {
    const seven = await open("copy.7z");
    expect(entry(seven, "image.png").method).toBe("Copy");
    const png = await seven.read(entry(seven, "image.png"));
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(await read(seven, "hello.txt")).toBe(TREE.hello);
  });

  it("reads the start header and the end header, not the packed streams", async () => {
    const bytes = fixture("solid.7z");
    const memory = memorySource(bytes);
    let total = 0;
    const source = {
      size: memory.size,
      read: (offset: number, length: number) => {
        total += length;
        return memory.read(offset, length);
      },
    };
    const seven = await openSevenZip(source, "solid.7z");
    expect(seven.entries.length).toBeGreaterThan(4);
    expect(total).toBeLessThan(bytes.length / 2);
  });

  it("answers the Archive shape: a first `limit` bytes and `each` over a solid block", async () => {
    const seven = await open("solid.7z");
    expect(utf8(await seven.read(entry(seven, "hello.txt"), 5))).toBe("Hello");
    const wanted = ["words.txt", "hello.txt", "docs/readme.md"].map((path) => entry(seven, path));
    const seen = new Map<string, string>();
    await seven.each?.(wanted, async (e, bytes) => {
      seen.set(e.path, e.path === "words.txt" ? sha256(bytes) : utf8(bytes));
    });
    expect(seen).toEqual(
      new Map([
        ["docs/readme.md", TREE.readme],
        ["hello.txt", TREE.hello],
        ["words.txt", expected.words.sha256],
      ]),
    );
  });

  it("refuses what is not a 7z, and a cut one, in a sentence", async () => {
    await expect(
      openSevenZip(memorySource(fixture("plain.7z").subarray(0, 40)), "x.7z"),
    ).rejects.toThrow(/cut short|damaged|ends early/);
    await expect(openSevenZip(memorySource(new Uint8Array(64)), "x.7z")).rejects.toThrow(
      "This is not a 7z archive.",
    );
  });
});
