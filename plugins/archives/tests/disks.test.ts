// Disk images open as their partitions and files through endue.formats (#184, #185, #186): a GPT
// disk with FAT32 and ext4, a VHDX with NTFS, a DMG with APFS, a snap and a WIM. Each lists what the
// kernel (or the tool) put there under the details of today, previews a file and extracts one file
// to the byte. The volumes are the library's fixtures, made by mkfs.fat, mke2fs, mkntfs, hdiutil,
// mksquashfs and wimlib; the GPT and VHDX around them are built in memory (disk-images.ts).
import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import {
  gptOf,
  LINUX_DATA,
  libraryEntries,
  libraryFixture,
  MICROSOFT_DATA,
  vhdxWith,
} from "./disk-images";
import { type Archive, detail, entry, open, sha256, TREE, utf8 } from "./fixtures";
import { file, mount, READ } from "./harness";

const TARGET = "~/Downloads/out";
const sha16 = (bytes: Uint8Array) => sha256(bytes).slice(0, 16);
const paths = (archive: Archive, kind: string) =>
  archive.entries.filter((e) => e.kind === kind).map((e) => e.path);

/** The archive at ~/Downloads/<name>, opened by the plugin: `path` previewed, then extracted. */
async function extract(bytes: Uint8Array, name: string, path: string) {
  const at = `~/Downloads/${name}`;
  const written: Record<string, Uint8Array> = {};
  const { host, app, view, settle } = await mount({
    files: { [at]: bytes },
    grants: [READ("~/Downloads")],
    handlers: {
      "fs.write": ({ path, content }) => {
        written[path] = new Uint8Array(Buffer.from(content, "base64"));
        return { bytesWritten: content.length };
      },
      "fs.list": () => {
        throw new StubError("not_found", "nothing is there yet");
      },
    },
    commands: { "desk.palette.pick": () => TARGET },
  });
  await host.command("desk.files.visit", file(at));
  // As a person would: open the folders down to the file, then select it.
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    const folder = parts.slice(0, i).join("/");
    if (!view.archives.at(-1)?.rows.find((r) => r.id === folder)?.expanded) app.toggle(folder);
  }
  await app.select(path);
  await settle();
  const preview = view.previews.at(-1);
  await app.extract("selected");
  return { written, preview, status: view.statuses.at(-1) ?? "", shown: view.archives.at(-1) };
}

const FAT32 = libraryFixture("disk/fixtures/fat32.img.gz");
const EXT4 = libraryFixture("disk/fixtures/ext4.img.gz");
const NTFS = libraryFixture("disk/fixtures/ntfs.img.gz");

describe("a GPT disk with FAT32 and ext4", () => {
  const disk = gptOf([
    { name: "data", type: MICROSOFT_DATA, bytes: FAT32 },
    { name: "root", type: LINUX_DATA, bytes: EXT4 },
  ]);

  it("lists both partitions' files under their labels, below the partition table", async () => {
    const img = await open(disk, "usb.img");
    expect(img.format).toBe("Disk image");
    expect(img.note).toBeUndefined();
    expect(detail(img, "Partition table")).toBe("GPT");
    expect(detail(img, "Partitions")).toBe("2");
    expect(detail(img, "Partition 1")).toBe(
      "data, Microsoft basic data, 34 MiB; FAT32 “FAT32DISK”, 400 KiB used",
    );
    expect(detail(img, "Partition 2")).toMatch(/^root, Linux filesystem, 12 MiB; ext4 “ext4-disk”/);
    for (const [folder, image] of [
      ["FAT32DISK", "fat32.img"],
      ["ext4-disk", "ext4.img"],
    ] as const) {
      expect(entry(img, folder).kind).toBe("folder");
      const want = libraryEntries(image).filter((e) => e.kind === "file");
      const got = new Map(img.entries.map((e) => [e.path, e]));
      for (const e of want) expect(got.get(`${folder}/${e.path}`)?.size, e.path).toBe(e.size);
    }
    const readme = entry(img, "FAT32DISK/docs/readme.md");
    expect(utf8(await img.read(readme, 15))).toBe("# Disk fixtures");
  });

  it("previews and extracts a file from the ext4 partition to the byte", async () => {
    const want = libraryEntries("ext4.img").find((e) => e.path === "data/pattern.bin");
    const { written, preview, status } = await extract(
      disk,
      "usb.img",
      "ext4-disk/data/pattern.bin",
    );
    expect(preview).toMatchObject({ kind: "text", name: "pattern.bin" });
    const bytes = written[`${TARGET}/ext4-disk/data/pattern.bin`];
    expect(bytes?.length).toBe(want?.size);
    expect(bytes && sha16(bytes)).toBe(want?.sha256);
    expect(status).toContain(`Extracted 1 file (300 KiB) to ${TARGET}.`);
  });
});

describe("a VHDX with NTFS", () => {
  const vhdx = vhdxWith(
    gptOf([{ name: "Basic data partition", type: MICROSOFT_DATA, bytes: NTFS }], 64 << 20),
  );

  it("lists the NTFS volume's files at the top, below the VHDX's details", async () => {
    const disk = await open(vhdx, "windows.vhdx");
    expect(disk.format).toBe("VHDX");
    expect(disk.note).toBeUndefined();
    expect(detail(disk, "Virtual size")).toBe("64 MiB (67,108,864 bytes)");
    expect(detail(disk, "Type")).toBe("Dynamic");
    expect(detail(disk, "Partition table")).toBe("GPT");
    expect(detail(disk, "Partition 1")).toMatch(/Microsoft basic data, 16 MiB; NTFS “NTFSDISK”/);
    // NTFS lists a hard-linked file under one of its names, so those are left out here.
    const want = libraryEntries("ntfs.img").filter((e) => e.kind === "file" && !e.inode);
    for (const e of want) expect(entry(disk, e.path).size, e.path).toBe(e.size);
    expect(paths(disk, "folder")).toEqual(expect.arrayContaining(["compressed", "docs"]));
  });

  it("extracts an NTFS-compressed file to the byte", async () => {
    const want = libraryEntries("ntfs.img").find((e) => e.path === "compressed/text.txt");
    const { written, status } = await extract(vhdx, "windows.vhdx", "compressed/text.txt");
    const bytes = written[`${TARGET}/compressed/text.txt`];
    expect(bytes?.length).toBe(want?.size);
    expect(bytes && sha16(bytes)).toBe(want?.sha256);
    expect(status).toContain("Extracted 1 file (200 KiB)");
  });
});

describe("a DMG with APFS", () => {
  const dmg = libraryFixture("apple/fixtures/apfs.dmg");
  const volume = (
    JSON.parse(utf8(libraryFixture("apple/fixtures/expected.json"))) as {
      apfs: {
        volumes: Record<string, { path: string; kind: string; size: number; sha256?: string }[]>;
      };
    }
  ).apfs.volumes["Apple APFS"];

  it("lists the APFS volume's files below the image's and the volume's details", async () => {
    const image = await open(dmg, "Sample.dmg");
    expect(image.format).toBe("Apple disk image (UDZO)");
    expect(image.note).toBeUndefined();
    expect(detail(image, "Format")).toBe("UDIF, zlib-compressed (UDZO)");
    expect(detail(image, "Partition 1")).toBe(
      "disk image, Apple APFS, 8.0 MiB; APFS container, 1 volume",
    );
    expect(detail(image, "File system")).toBe("APFS");
    expect(detail(image, "Label")).toBe("Apple APFS");
    expect(volume?.length).toBeGreaterThan(80);
    expect(image.entries.map((e) => e.path).sort()).toEqual(
      (volume ?? []).map((e) => e.path).sort(),
    );
    expect(utf8(await image.read(entry(image, "links/hard-a.txt")))).toBe("one file, two names\n");
  });

  it("extracts a decmpfs-compressed file to the byte", async () => {
    const want = volume?.find((e) => e.path === "compressed/ditto.txt");
    const { written, preview, status } = await extract(dmg, "Sample.dmg", "compressed/ditto.txt");
    expect(preview).toMatchObject({ kind: "text", name: "ditto.txt" });
    const bytes = written[`${TARGET}/compressed/ditto.txt`];
    expect(bytes?.length).toBe(want?.size);
    expect(bytes && sha16(bytes)).toBe(want?.sha256);
    expect(status).toContain("Extracted 1 file (160 KiB)");
  });
});

describe("a snap", () => {
  const snap = libraryFixture("packs/fixtures/sample.snap");

  it("lists its files below the SquashFS superblock's details", async () => {
    const fs = await open(snap, "sample_1.0_all.snap");
    expect(fs.format).toBe("Snap");
    expect(fs.note).toBeUndefined();
    expect(detail(fs, "Compression")).toBe("xz");
    expect(detail(fs, "Inodes")).toBe("3");
    expect(detail(fs, "Created")).toBe("2026-10-01 12:00:00");
    expect(fs.entries.map((e) => [e.path, e.kind, e.size])).toEqual([
      ["readme.md", "file", 56],
      ["한글.txt", "file", 16],
    ]);
  });

  it("previews and extracts a file to the byte", async () => {
    const { written, preview, status } = await extract(snap, "sample_1.0_all.snap", "readme.md");
    expect(preview).toMatchObject({ kind: "text", name: "readme.md", text: TREE.readme });
    expect(utf8(written[`${TARGET}/readme.md`] ?? new Uint8Array())).toBe(TREE.readme);
    expect(status).toContain("Extracted 1 file (56 bytes)");
  });
});

describe("a WIM", () => {
  const wim = libraryFixture("packs/fixtures/sample.wim");

  it("lists each image as a folder of its files, below the header's details", async () => {
    const image = await open(wim, "install.wim");
    expect(image.format).toBe("WIM");
    expect(image.note).toBeUndefined();
    expect([detail(image, "Images"), detail(image, "Compression")]).toEqual(["2", "LZX"]);
    expect([detail(image, "Image 1"), detail(image, "Image 2")]).toEqual(["Sample", "Second"]);
    expect(image.entries.map((e) => `${e.kind} ${e.path} ${e.size}`)).toEqual([
      "folder 1 Sample 0",
      "file 1 Sample/readme.md 56",
      "file 1 Sample/한글.txt 16",
      "folder 2 Second 0",
      "file 2 Second/readme.md 56",
      "file 2 Second/한글.txt 16",
    ]);
  });

  it("previews and extracts a file of the second image to the byte", async () => {
    const { written, preview, status } = await extract(wim, "install.wim", "2 Second/한글.txt");
    expect(preview).toMatchObject({ kind: "text", text: TREE.korean });
    expect(utf8(written[`${TARGET}/2 Second/한글.txt`] ?? new Uint8Array())).toBe(TREE.korean);
    expect(status).toContain("Extracted 1 file (16 bytes)");
  });
});
