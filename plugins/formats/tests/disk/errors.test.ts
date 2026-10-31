import { describe, expect, it } from "vitest";
import { openContainer, openDisk, openFilesystem } from "../../lib/disk/index.js";
import { memorySource } from "../../lib/disk/source.js";
import { copy, counted, detail, image } from "./fixtures";

/** The details-only answer a refused image gets: its facts and one sentence, nothing listed. */
async function refused(bytes: Uint8Array, sentence: RegExp) {
  const disk = await openDisk(memorySource(bytes));
  expect(disk.entries).toEqual([]);
  expect(disk.note).toMatch(sentence);
  expect(disk.refusal).toMatch(sentence);
  await expect(disk.read({ path: "x", kind: "file", size: 1 })).rejects.toThrow(sentence);
  return disk;
}

describe("refusals", () => {
  it("refuses a differencing VHD: its files need the parent image", async () => {
    const disk = await refused(image("differencing.vhd"), /differencing disk.*parent/);
    expect(disk.format).toBe("VHD");
    expect(detail(disk, "Virtual size")).toMatch(/12 MiB/);
    await expect(openContainer(memorySource(image("differencing.vhd")))).rejects.toThrow(/parent/);
  });

  it("refuses a QCOW2 with a backing file and names the file", async () => {
    const disk = await refused(image("child.qcow2"), /backing file.*gpt-v3\.qcow2/);
    expect(disk.format).toBe("QCOW2");
  });

  it("refuses a split VMDK, from its descriptor or from one of its extents", async () => {
    await refused(image("split.vmdk"), /split into 2 extent files/);
    await refused(image("split-s001.vmdk"), /one extent of a split VMDK/);
  });

  it("refuses QCOW2 clusters compressed with Zstandard", async () => {
    await refused(image("gpt-zstd.qcow2"), /Zstandard/);
  });
});

describe("damage", () => {
  it("fails on an ext4 superblock whose checksum does not match", async () => {
    const bytes = copy("ext4.img");
    bytes[1024 + 0x78] = 0x58; // a letter of the volume name
    await expect(openFilesystem(memorySource(bytes))).rejects.toThrow(
      "The ext4 superblock is damaged: its checksum does not match.",
    );
    const disk = await openDisk(memorySource(bytes));
    expect(disk.entries).toEqual([]);
    expect(disk.note).toMatch(/superblock is damaged/);
  });

  it("fails on a FAT boot sector with impossible geometry", async () => {
    const bytes = copy("fat16.img");
    bytes[13] = 3; // sectors per cluster must be a power of two
    await expect(openFilesystem(memorySource(bytes))).rejects.toThrow(/FAT boot sector is damaged/);
  });

  it("fails on an NTFS volume whose MFT is not where the boot sector says", async () => {
    const bytes = copy("ntfs.img");
    new DataView(bytes.buffer).setUint32(0x30, 1000, true); // the MFT's first cluster
    await expect(openFilesystem(memorySource(bytes))).rejects.toThrow(/MFT is damaged/);
  });

  it("fails on a GPT whose header and backup both fail their checksums", async () => {
    const bytes = copy("gpt.img");
    bytes[512 + 40] ^= 0xff;
    bytes[bytes.length - 512 + 40] ^= 0xff;
    await expect(openDisk(memorySource(bytes))).rejects.toThrow(/GPT partition table is damaged/);
  });

  it("reads a GPT from its backup header when the first one is damaged", async () => {
    const bytes = copy("gpt.img");
    bytes[512 + 40] ^= 0xff;
    const disk = await openDisk(memorySource(bytes));
    expect(detail(disk, "Partitions")).toBe("3");
  });

  it("fails on a dynamic VHD cut short", async () => {
    const whole = image("gpt-dynamic.vhd");
    await expect(openDisk(memorySource(whole.slice(0, 3000)))).rejects.toThrow(/VHD/);
  });

  it("fails on damaged deflate data in a stream-optimized VMDK", async () => {
    const bytes = copy("gpt-stream.vmdk");
    // The first grain after the header, descriptor and its marker: break its deflate data.
    for (let at = 64 * 1024; at < bytes.length - 2048; at += 512)
      if (bytes[at + 12] === 0x78) {
        bytes.fill(0xff, at + 14, at + 40);
        break;
      }
    await expect(openDisk(memorySource(bytes))).rejects.toThrow(/compressed|damaged/i);
  });
});

describe("cancelling", () => {
  it("stops listing when the signal aborts", async () => {
    const controller = new AbortController();
    const { source, counter } = counted(image("ntfs.img"), (reads) => {
      if (reads === 6) controller.abort();
    });
    await expect(openDisk(source, { signal: controller.signal })).rejects.toThrow(
      /cancel|abort/i,
    );
    const after = counter.reads;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(counter.reads).toBe(after);
    expect(after).toBeLessThan(20);
  });

  it("starts nothing when the signal has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { source, counter } = counted(image("ext4.img"));
    await expect(openFilesystem(source, { signal: controller.signal })).rejects.toThrow(
      /cancel|abort/i,
    );
    expect(counter.reads).toBe(0);
  });

  it("stops reading a file when the signal aborts", async () => {
    const volume = await openFilesystem(memorySource(image("ext4.img")));
    const big = volume.entries.find((e) => e.path === "big/large.txt");
    const controller = new AbortController();
    controller.abort();
    await expect(
      volume.read(big as (typeof volume.entries)[number], undefined, { signal: controller.signal }),
    ).rejects.toThrow(/cancel|abort/i);
  });
});
