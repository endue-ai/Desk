import { describe, expect, it } from "vitest";
import {
  type Archive,
  concat,
  detail,
  entry,
  expected,
  files,
  fixture,
  gunzipped,
  open,
  read,
  TREE,
  WHEN,
} from "./fixtures";

/** Every detail as "label: value" lines. */
const details = (archive: Archive) =>
  archive.details.map((d) => `${d.label}: ${d.value}`).join("\n");

describe("contents only: listed, extraction refused with a reason", () => {
  it("RAR 4: names, sizes and dates; stored entries read", async () => {
    const rar = await open(fixture("rar4.rar"), "rar4.rar");
    expect(rar.format).toBe("RAR 4");
    expect(rar.refusal).toBe("RAR decompression is not available.");
    expect(files(rar)).toEqual(["docs/readme.md", "hello.txt"]);
    expect(entry(rar, "docs")).toMatchObject({ kind: "folder" });
    expect(entry(rar, "hello.txt")).toMatchObject({ size: 17, packed: 17, method: "Stored" });
    expect(entry(rar, "hello.txt").date).toBeInstanceOf(Date);
    expect(await read(rar, "hello.txt")).toBe(TREE.hello);
  });

  it("RAR 5: the stored entries' data, and a compressed entry refused", async () => {
    const rar = await open(fixture("rar5.rar"), "rar5.rar");
    expect(rar.format).toBe("RAR 5");
    expect(rar.refusal).toBe("RAR decompression is not available.");
    expect(files(rar)).toEqual(["docs/readme.md", "hello.txt", "words.txt"]);
    expect(entry(rar, "words.txt")).toMatchObject({ size: 48069 });
    expect(entry(rar, "words.txt").packed).toBeLessThan(48069);
    expect(entry(rar, "hello.txt").date?.toISOString()).toBe(WHEN);
    expect(await read(rar, "docs/readme.md")).toBe(TREE.readme);
    await expect(rar.read(entry(rar, "words.txt"))).rejects.toThrow(
      "RAR decompression is not available.",
    );
  });

  it("ARJ: a header listing", async () => {
    const arj = await open(fixture("sample.arj"), "sample.arj");
    expect(arj.format).toBe("ARJ");
    expect(arj.refusal).toBe("ARJ decompression is not available.");
    expect(files(arj)).toEqual(["docs/readme.md", "hello.txt", "words.txt"]);
    expect(entry(arj, "words.txt")).toMatchObject({ size: 48069 });
    expect(entry(arj, "hello.txt").date?.toISOString()).toBe(WHEN);
  });

  it("LHA: a header listing with methods", async () => {
    const lha = await open(fixture("sample.lzh"), "sample.lzh");
    expect(lha.format).toBe("LHA");
    expect(lha.refusal).toBe("LHA decompression is not available.");
    expect(files(lha)).toEqual(["docs/readme.md", "hello.txt", "words.txt"]);
    expect(entry(lha, "words.txt")).toMatchObject({ size: 48069, method: "-lh5-" });
    expect(entry(lha, "hello.txt")).toMatchObject({ method: "-lh0-" });
    expect(entry(lha, "hello.txt").date?.toISOString()).toBe(WHEN);
  });

  it("MSI: the compound file's streams under their decoded names", async () => {
    const msi = await open(fixture("sample.msi"), "sample.msi");
    expect(msi.format).toBe("MSI");
    expect(msi.refusal).toBe("Extracting MSI streams is not available.");
    expect(files(msi)).toEqual(
      expect.arrayContaining(["sample.cab", "[5]SummaryInformation", "!_Tables", "!File"]),
    );
    expect(entry(msi, "sample.cab").size).toBeGreaterThan(60);
  });
});

describe("details only", () => {
  it("DMG: the UDIF trailer and its partition list", async () => {
    const dmg = await open(fixture("sample.dmg"), "sample.dmg");
    expect(dmg.format).toBe("DMG");
    expect(dmg.entries).toEqual([]);
    expect(dmg.note).toBe("Browsing the files inside a DMG is not available.");
    expect(details(dmg)).toContain("Apple_HFS");
    expect(details(dmg)).toMatch(/Partitions: \d+/);
  });

  it("IMG with an MBR: the partition table", async () => {
    const img = await open(gunzipped("mbr.img.gz"), "mbr.img");
    expect(img.format).toBe("Disk image");
    expect(detail(img, "Partition table")).toBe("MBR");
    expect(detail(img, "Partition 1")).toBe("Linux (0x83), 1.0 MiB");
    expect(detail(img, "Partition 2")).toMatch(/^NTFS, exFAT or HPFS \(0x07\), /);
  });

  it("IMG with a GPT: names and types", async () => {
    const img = await open(gunzipped("gpt.img.gz"), "gpt.img");
    expect(detail(img, "Partition table")).toBe("GPT");
    expect(detail(img, "Partition 1")).toBe("root, Linux filesystem, 1.0 MiB");
    expect(detail(img, "Partition 2")).toMatch(/^efi, EFI system, /);
  });

  for (const [file, format, extra] of [
    ["disk.vhd.gz", "VHD", "Type: Dynamic"],
    ["disk.vhdx.gz", "VHDX", "Version: 1"],
    ["disk.vmdk.gz", "VMDK", "Version: 1"],
    ["disk.qcow2.gz", "QCOW2", "Version: 3"],
  ] as const) {
    it(`${format}: virtual size and format version`, async () => {
      const disk = await open(gunzipped(file), file.replace(/\.gz$/, ""));
      expect(disk.format).toBe(format);
      expect(disk.note).toBe(`Browsing the files inside a ${format} is not available.`);
      expect(detail(disk, "Virtual size")).toMatch(/^64 MiB \(67,1\d\d,\d{3} bytes\)$/);
      expect(details(disk)).toContain(extra);
    });
  }

  it("WIM: the image count and names from its XML", async () => {
    const wim = await open(fixture("sample.wim"), "sample.wim");
    expect(wim.format).toBe("WIM");
    expect(detail(wim, "Images")).toBe("2");
    expect(detail(wim, "Image 1")).toBe("Sample");
    expect(detail(wim, "Image 2")).toBe("Second");
    expect(detail(wim, "Compression")).toBe("LZX");
  });

  it("Snap: the SquashFS superblock", async () => {
    const snap = await open(fixture("sample.snap"), "sample.snap");
    expect(snap.format).toBe("Snap");
    expect(detail(snap, "Compression")).toBe("xz");
    expect(detail(snap, "Inodes")).toBe("3");
    expect(detail(snap, "Created")).toContain("2026-10-01");
  });

  it("AppImage: the SquashFS after the ELF runtime", async () => {
    // A 64-bit ELF header with no sections and the type 2 AppImage mark, then the file system.
    const elf = new Uint8Array(64);
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 2]);
    const view = new DataView(elf.buffer);
    view.setUint16(52, 64, true); // e_ehsize
    view.setBigUint64(40, 0n, true); // e_shoff
    view.setUint16(58, 64, true); // e_shentsize
    const image = await open(concat([elf, fixture("sample.squashfs")]), "Sample.AppImage");
    expect(image.format).toBe("AppImage");
    expect(detail(image, "Compression")).toBe("gzip");
    expect(detail(image, "Inodes")).toBe("3");
  });

  it("torrent: name, files with sizes, piece length, trackers and the info hash", async () => {
    const torrent = await open(fixture("tree.torrent"), "tree.torrent");
    expect(torrent.format).toBe("Torrent");
    expect(detail(torrent, "Name")).toBe("docs");
    expect(detail(torrent, "Piece length")).toBe("32 KiB");
    expect(detail(torrent, "Tracker 1")).toBe("http://tracker.example/announce");
    expect(detail(torrent, "Tracker 2")).toBe("http://backup.example/announce");
    expect(detail(torrent, "Comment")).toBe("A sample torrent");
    expect(detail(torrent, "Info hash")).toBe(expected.torrent.infoHash);
    expect(files(torrent)).toEqual(["docs/readme.md", TREE.koreanName]);
    expect(entry(torrent, "docs/readme.md").size).toBe(56);
    expect(torrent.refusal).toBe("A torrent lists files; it does not hold them.");
  });
});
