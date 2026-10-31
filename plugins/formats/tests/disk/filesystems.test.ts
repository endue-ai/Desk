import { describe, expect, it } from "vitest";
import { openDisk, openFilesystem } from "../../lib/disk/index.js";
import { memorySource } from "../../lib/disk/source.js";
import {
  counted,
  detail,
  type Expected,
  entry,
  expected,
  image,
  paths,
  sha,
  utf8,
  wallClock,
} from "./fixtures";

const SYSTEMS = Object.entries(expected.filesystems);
/** FAT keeps local wall-clock time; the others keep UTC (exFAT with its offset). */
const seconds = (type: string, date: Date) =>
  type.startsWith("FAT") ? wallClock(date) : date.getTime() / 1000;
/** NTFS lists a file with several names (hard links) once. */
function wanted(type: string, entries: Expected[]) {
  if (type !== "NTFS") return entries;
  const seen = new Set<number>();
  return entries.filter((e) => e.inode === undefined || (!seen.has(e.inode) && seen.add(e.inode)));
}

describe.each(SYSTEMS)("%s", (name, fs) => {
  it(`opens as ${fs.type} with its label, size and use`, async () => {
    const volume = await openFilesystem(memorySource(image(name)));
    expect(volume.format).toBe(fs.type);
    expect(detail(volume, "File system")).toBe(fs.type);
    expect(detail(volume, "Label")).toBe(fs.label);
    expect(detail(volume, "Size")).toMatch(/MiB|KiB/);
    expect(detail(volume, "Used")).toMatch(/\d/);
  });

  it("lists every file, folder and link the kernel sees, with sizes, kinds and dates", async () => {
    const volume = await openFilesystem(memorySource(image(name)));
    const want = wanted(fs.type, fs.entries);
    const got = paths(volume);
    if (fs.type === "NTFS") {
      // One name for each hard-linked file, whichever the MFT gives first.
      const links = fs.entries.filter((e) => e.inode !== undefined).map((e) => e.path);
      const kept = links.filter((path) => got.includes(path));
      expect(kept).toHaveLength(links.length / 2);
      expect(got.filter((path) => !links.includes(path))).toEqual(
        fs.entries.map((e) => e.path).filter((path) => !links.includes(path)),
      );
    } else expect(got).toEqual(want.map((e) => e.path));
    for (const file of want) {
      if (!got.includes(file.path)) continue;
      const found = entry(volume, file.path);
      expect(found, file.path).toMatchObject({ kind: file.kind, size: file.size });
      if (file.link) expect(found.link).toBe(file.link);
      if (file.kind !== "folder")
        expect(Math.abs(seconds(fs.type, found.date as Date) - file.mtime), file.path).toBeLessThan(
          0.011,
        );
    }
  });

  it("reads each file's exact bytes", async () => {
    const volume = await openFilesystem(memorySource(image(name)));
    for (const file of fs.entries) {
      if (file.kind !== "file" || !paths(volume).includes(file.path)) continue;
      expect(sha(await volume.read(entry(volume, file.path))), file.path).toBe(file.sha256);
    }
  });

  it("reads the first bytes of a file when given a limit", async () => {
    const volume = await openFilesystem(memorySource(image(name)));
    const pattern = await volume.read(entry(volume, "data/pattern.bin"), 100);
    expect(utf8(pattern)).toMatch(/^pattern block 000000\nThe quick brown fox/);
    expect(pattern.length).toBe(100);
  });

  it("reads its directories and the files asked for, not the whole image", async () => {
    const { source, counter } = counted(image(name));
    const volume = await openFilesystem(source);
    const listing = counter.bytes;
    expect(listing).toBeLessThan(image(name).length / 3);
    await volume.read(entry(volume, "hello.txt"));
    expect(counter.bytes - listing).toBeLessThan(256 * 1024);
  });

  it("opens through openDisk with bare paths", async () => {
    const disk = await openDisk(memorySource(image(name)));
    expect(detail(disk, "File system")).toBe(fs.type);
    expect(utf8(await disk.read(entry(disk, "hello.txt")))).toBe("Hello, disks!\n");
  });
});

describe("file system specifics", () => {
  it("FAT32 follows a broken cluster chain and skips deleted entries", async () => {
    const volume = await openFilesystem(memorySource(image("fat32.img")));
    expect(utf8(await volume.read(entry(volume, "frag-c.bin")))).toMatch(/^frag c block 000000/);
    expect(paths(volume)).not.toContain("gone.txt");
    expect(paths(volume)).not.toContain("frag-a.bin");
  });

  it("exFAT reads files grown through the FAT and contiguous ones", async () => {
    const volume = await openFilesystem(memorySource(image("exfat.img")));
    const turns = utf8(await volume.read(entry(volume, "turns-b.bin")));
    expect(turns).toMatch(/^turns b 00 block 000000/);
    expect(turns).toContain("turns b 11 block 000000");
  });

  it("ext4 reads inline data, an extent tree, a sparse file and both kinds of symlink", async () => {
    const volume = await openFilesystem(memorySource(image("ext4.img")));
    expect(utf8(await volume.read(entry(volume, "hello.txt")))).toBe("Hello, disks!\n");
    const islands = await volume.read(entry(volume, "big/islands.bin"));
    expect(utf8(islands.subarray(15 * 128 * 1024, 15 * 128 * 1024 + 16))).toBe("island 15 block ");
    expect(islands.subarray(4096, 128 * 1024).every((b) => b === 0)).toBe(true);
    expect(entry(volume, "link-to-readme")).toMatchObject({ kind: "link", link: "docs/readme.md" });
    expect(entry(volume, "long-link").link).toHaveLength(74);
    expect(entry(volume, "big/large.txt").size).toBeGreaterThan(1024 * 1024);
  });

  it("NTFS reads compressed and sparse files and leaves alternate streams out", async () => {
    const volume = await openFilesystem(memorySource(image("ntfs.img")));
    const text = entry(volume, "compressed/text.txt");
    expect(text.method).toBe("LZNT1");
    expect(text.packed).toBeLessThan(text.size / 2);
    const sparse = await volume.read(entry(volume, "sparse.bin"));
    expect(utf8(sparse.subarray(0, 27))).toBe("the start of a sparse file\n");
    expect(utf8(sparse.subarray(2 * 1024 * 1024 + 100, 2 * 1024 * 1024 + 125))).toBe(
      "the end of a sparse file\n",
    );
    expect(paths(volume).some((path) => path.includes(":"))).toBe(false);
    expect(paths(volume).some((path) => path.startsWith("$"))).toBe(false);
  });
});
