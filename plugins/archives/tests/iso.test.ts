import { describe, expect, it } from "vitest";
import { openArchive } from "../ui/formats/index.js";
import { memorySource } from "../ui/source.js";
import { detail, entry, expected, files, gunzipped, read, sha256, TREE, WHEN } from "./fixtures";

const ISO = gunzipped("tree.iso.gz");

/** The image behind a source that counts the bytes read. */
function counted(bytes: Uint8Array) {
  const memory = memorySource(bytes);
  const counter = { total: 0 };
  const source = {
    size: memory.size,
    read: (offset: number, length: number) => {
      counter.total += length;
      return memory.read(offset, length);
    },
  };
  return { source, counter };
}

describe("ISO 9660", () => {
  it("lists hdiutil's image under its Joliet names, with sizes and dates", async () => {
    const iso = await openArchive(memorySource(ISO), "tree.iso");
    expect(iso.format).toBe("ISO 9660");
    expect(detail(iso, "Volume")).toBe("SAMPLE");
    expect(detail(iso, "Names")).toBe("Joliet");
    expect(files(iso)).toEqual(
      [
        "data.bin",
        TREE.long,
        "docs/readme.md",
        TREE.koreanName,
        "hello.txt",
        "image.png",
        "inner.zip",
        "link",
        "words.txt",
      ].sort(),
    );
    expect(entry(iso, "docs")).toMatchObject({ kind: "folder" });
    expect(entry(iso, "words.txt")).toMatchObject({ kind: "file", size: 48069 });
    expect(entry(iso, "hello.txt").date?.toISOString()).toBe(WHEN);
  });

  it("extracts files to the original bytes", async () => {
    const iso = await openArchive(memorySource(ISO), "tree.iso");
    expect(await read(iso, TREE.koreanName)).toBe(TREE.korean);
    expect(await read(iso, TREE.long)).toBe("A long name.\n");
    expect(sha256(await iso.read(entry(iso, "words.txt")))).toBe(expected.words.sha256);
  });

  it("reads the descriptors and directories record by record, not the files", async () => {
    const { source, counter } = counted(ISO);
    const iso = await openArchive(source, "tree.iso");
    expect(iso.entries.length).toBeGreaterThan(10);
    expect(counter.total).toBeLessThan(ISO.length / 4);
  });
});
