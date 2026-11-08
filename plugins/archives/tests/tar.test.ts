import { describe, expect, it } from "vitest";
import { openArchive } from "../ui/formats/index.js";
import { memorySource } from "../ui/source.js";
import {
  concat,
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
} from "./fixtures";

const PAX_FILES = [
  "data.bin",
  "docs/readme.md",
  TREE.koreanName,
  "hello.txt",
  "image.png",
  "inner.zip",
  TREE.long,
  "link",
].sort();

/** One ustar header block and the data padded to 512 bytes. */
function tarFile(name: string, data: Uint8Array) {
  const head = new Uint8Array(512);
  const put = (at: number, text: string) => head.set(new TextEncoder().encode(text), at);
  put(0, name);
  put(100, "0000644\0");
  put(124, `${data.length.toString(8).padStart(11, "0")}\0`);
  put(136, `${(Date.parse(WHEN) / 1000).toString(8).padStart(11, "0")}\0`);
  put(148, "        ");
  put(156, "0");
  put(257, "ustar\u000000");
  const sum = head.reduce((n, b) => n + b, 0);
  put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  return concat([head, padded]);
}

describe("tar", () => {
  it("reads ustar: names, sizes, dates, a folder and a link", async () => {
    const tar = await open(fixture("ustar.tar"), "ustar.tar");
    expect(tar.format).toBe("tar");
    expect(files(tar)).toEqual(["docs/readme.md", TREE.koreanName, "hello.txt", "link"].sort());
    expect(entry(tar, "docs")).toMatchObject({ kind: "folder" });
    expect(entry(tar, "link")).toMatchObject({ kind: "link", link: "hello.txt" });
    expect(entry(tar, "hello.txt")).toMatchObject({ kind: "file", size: 17 });
    expect(entry(tar, "hello.txt").date?.toISOString()).toBe(WHEN);
    expect(await read(tar, "docs/readme.md")).toBe(TREE.readme);
  });

  it("reads GNU long names", async () => {
    const tar = await open(fixture("gnu.tar"), "gnu.tar");
    expect(files(tar)).toContain(TREE.long);
    expect(await read(tar, TREE.long)).toBe("A long name.\n");
    expect(await read(tar, TREE.koreanName)).toBe(TREE.korean);
  });

  it("reads PAX headers: long and UTF-8 names", async () => {
    const tar = await open(fixture("pax.tar"), "pax.tar");
    expect(files(tar)).toEqual(PAX_FILES);
    expect(await read(tar, TREE.long)).toBe("A long name.\n");
    expect(entry(tar, TREE.koreanName).date?.toISOString()).toBe(WHEN);
  });

  for (const [file, format] of [
    ["tree.tar.gz", "tar (gzip)"],
    ["tree.tbz2", "tar (bzip2)"],
    ["tree.txz", "tar (xz)"],
    ["tree.tar.zst", "tar (Zstandard)"],
    ["tree.tar.lz4", "tar (LZ4)"],
  ] as const) {
    it(`reads ${file} as a tar inside the stream`, async () => {
      const tar = await open(fixture(file), file);
      expect(tar.format).toBe(format);
      expect(files(tar)).toEqual(PAX_FILES);
      expect(await read(tar, "hello.txt")).toBe(TREE.hello);
      const data = await tar.read(entry(tar, "data.bin"));
      expect([...data.subarray(0, 4)]).toEqual([0, 1, 2, 3]);
      expect(data.length).toBe(4096);
    });
  }

  it("reads a plain tar's headers block by block, skipping the data", async () => {
    const bytes = concat([
      tarFile("a.txt", new TextEncoder().encode("A\n")),
      tarFile("big.bin", noise(600_000)),
      tarFile("z.txt", new TextEncoder().encode("Z\n")),
      new Uint8Array(1024),
    ]);
    const memory = memorySource(bytes);
    let total = 0;
    const source = {
      size: memory.size,
      read: (offset: number, length: number) => {
        total += length;
        return memory.read(offset, length);
      },
    };
    const tar = await openArchive(source, "big.tar");
    expect(files(tar)).toEqual(["a.txt", "big.bin", "z.txt"]);
    expect(total).toBeLessThan(200_000);
    expect(await read(tar, "z.txt")).toBe("Z\n");
  });

  it("an archive inside an archive opens one level down", async () => {
    const tar = await open(fixture("pax.tar"), "pax.tar");
    const inner = await open(await tar.read(entry(tar, "inner.zip")), "inner.zip");
    expect(inner.format).toBe("ZIP");
    expect(await read(inner, "hello.txt")).toBe(TREE.hello);
  });
});

describe("single compressed streams", () => {
  it("a .gz is one entry under the name and date in its header", async () => {
    const gz = await open(fixture("hello.txt.gz"), "renamed.gz");
    expect(gz.format).toBe("gzip");
    expect(gz.entries).toHaveLength(1);
    expect(entry(gz, "hello.txt")).toMatchObject({ kind: "file", size: 17 });
    expect(entry(gz, "hello.txt").date?.toISOString()).toBe(WHEN);
    expect(await read(gz, "hello.txt")).toBe(TREE.hello);
  });

  for (const [file, format] of [
    ["text.bz2", "bzip2"],
    ["text.xz", "xz"],
    ["text.lzma", "LZMA"],
    ["text.zst", "Zstandard"],
    ["text.lz4", "LZ4"],
    ["text.Z", "compress"],
  ] as const) {
    it(`${file} is one entry named without its extension`, async () => {
      const stream = await open(fixture(file), file);
      expect(stream.format).toBe(format);
      expect(stream.entries.map((e) => e.path)).toEqual(["text"]);
      expect(sha256(await stream.read(entry(stream, "text")))).toBe(expected.text.sha256);
    });
  }

  it("a stream's preview decodes only its start", async () => {
    const stream = await open(fixture("text.bz2"), "text.bz2");
    const head = await stream.read(entry(stream, "text"), 4096);
    expect(head.length).toBe(4096);
    expect(utf8(head).startsWith("00001 ")).toBe(true);
  });
});
