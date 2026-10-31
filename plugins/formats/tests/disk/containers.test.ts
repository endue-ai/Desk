import { describe, expect, it } from "vitest";
import { crc32c, u32 } from "../../lib/disk/bytes.js";
import { openContainer, openDisk } from "../../lib/disk/index.js";
import { memorySource } from "../../lib/disk/source.js";
import {
  copy,
  counted,
  detail,
  entry,
  expected,
  image,
  paths,
  sha,
  sha256,
  sourceHash,
  utf8,
} from "./fixtures";

const RAW = expected.disks["gpt.img"];
const CONTAINERS: [string, string, string][] = [
  ["gpt-fixed.vhd", "VHD", "Fixed"],
  ["gpt-dynamic.vhd", "VHD", "Dynamic"],
  ["gpt-dynamic.vhdx", "VHDX", "Dynamic"],
  ["gpt-fixed.vhdx", "VHDX", "Fixed"],
  ["gpt-sparse.vmdk", "VMDK", "monolithicSparse"],
  ["gpt-stream.vmdk", "VMDK", "streamOptimized"],
  ["gpt-v2.qcow2", "QCOW2", "Version 2"],
  ["gpt-v3.qcow2", "QCOW2", "Version 3"],
  ["gpt-deflate.qcow2", "QCOW2", "Version 3"],
];

describe("virtual disk containers", () => {
  it.each(CONTAINERS)("%s gives the raw image's virtual bytes", async (name, format, type) => {
    const container = await openContainer(memorySource(image(name)));
    expect(container.format).toBe(format);
    expect([detail(container, "Type"), detail(container, "Version")]).toContain(
      type.replace("Version ", ""),
    );
    expect(container.disk.size).toBe(RAW?.size);
    expect(await sourceHash(container.disk)).toBe(RAW?.sha256);
  });

  it("reads a raw image as it is", async () => {
    const container = await openContainer(memorySource(image("gpt.img")));
    expect(container.format).toBe("Disk image");
    expect(await sourceHash(container.disk)).toBe(RAW?.sha256);
  });

  it("reads a monolithic flat VMDK through its extent file", async () => {
    const raw = memorySource(image("gpt.img"));
    const container = await openContainer(memorySource(image("gpt-flat.vmdk")), {
      open: async (name: string) => (name === "gpt-flat-flat.vmdk" ? raw : undefined),
    });
    expect(container.format).toBe("VMDK");
    expect(await sourceHash(container.disk)).toBe(RAW?.sha256);
    await expect(openContainer(memorySource(image("gpt-flat.vmdk")))).rejects.toThrow(
      /gpt-flat-flat\.vmdk/,
    );
  });

  it.each(["big.vhd", "big.vhdx", "big.vmdk", "big.qcow2"])(
    "%s maps blocks past 4 GiB",
    async (name) => {
      const container = await openContainer(memorySource(image(name)));
      expect(container.disk.size).toBe(expected.big.size);
      for (const marker of expected.big.markers)
        expect(sha256(await container.disk.read(marker.offset, marker.length))).toBe(marker.sha256);
      const hole = await container.disk.read(3 * 2 ** 30, 64 * 1024);
      expect(hole.every((b) => b === 0)).toBe(true);
    },
  );

  it("reports a VHDX whose log was never applied and reads it as it is", async () => {
    const bytes = copy("gpt-dynamic.vhdx");
    // Give the current header a log GUID and fix its CRC-32C.
    const headers = [64 * 1024, 128 * 1024];
    const seq = (o: number) => u32(bytes, o + 8) + u32(bytes, o + 12) * 2 ** 32;
    const current = (headers as [number, number]).sort((a, b) => seq(b) - seq(a))[0] as number;
    bytes.fill(0x5a, current + 48, current + 64);
    bytes.fill(0, current + 4, current + 8);
    const sum = crc32c(bytes.subarray(current, current + 4096));
    new DataView(bytes.buffer).setUint32(current + 4, sum, true);
    const disk = await openDisk(memorySource(bytes));
    expect(detail(disk, "Log")).toMatch(/never applied.*read as it is/);
    expect(paths(disk)).toEqual(paths(await openDisk(memorySource(image("gpt.img")))));
  });
});

describe("partition tables", () => {
  it("lists a GPT disk's partitions with names, types and sizes, and their files", async () => {
    const disk = await openDisk(memorySource(image("gpt.img")));
    expect(disk.format).toBe("Disk image");
    expect(detail(disk, "Partition table")).toBe("GPT");
    expect(detail(disk, "Partitions")).toBe("3");
    expect(detail(disk, "Partition 1")).toMatch(/EFI.*EFI system.*4\.0 MiB.*FAT16.*ESP/);
    expect(detail(disk, "Partition 2")).toMatch(/root.*Linux filesystem.*6\.0 MiB.*ext4.*rootfs/);
    expect(detail(disk, "Partition 3")).toMatch(/swap.*Linux swap/);
    const parts = RAW?.partitions ?? [];
    const want = [
      ...(parts[0]?.entries ?? []).map((e) => ({ ...e, path: `ESP/${e.path}` })),
      ...(parts[1]?.entries ?? []).map((e) => ({ ...e, path: `rootfs/${e.path}` })),
    ];
    for (const file of want) {
      const got = entry(disk, file.path);
      expect(got).toMatchObject({ kind: file.kind, size: file.size });
      if (file.sha256) expect(sha(await disk.read(got))).toBe(file.sha256);
    }
    expect(utf8(await disk.read(entry(disk, "ESP/hello.txt")))).toBe(
      "Hello from the EFI partition!\n",
    );
  });

  it("follows an MBR's extended partition to its logical ones", async () => {
    const disk = await openDisk(memorySource(image("mbr.img")));
    expect(detail(disk, "Partition table")).toBe("MBR");
    expect(detail(disk, "Partitions")).toBe("3");
    expect(detail(disk, "Partition 1")).toMatch(/FAT16.*4\.0 MiB.*MBRONE/);
    expect(detail(disk, "Partition 5")).toMatch(/Linux.*4\.0 MiB.*ext2.*logical-ext2/);
    expect(detail(disk, "Partition 6")).toMatch(/FAT12.*4\.0 MiB.*MBRTHREE/);
    for (const folder of ["MBRONE", "logical-ext2", "MBRTHREE"])
      expect(utf8(await disk.read(entry(disk, `${folder}/hello.txt`)))).toBe(
        "Hello from a partition!\n",
      );
  });

  it("reads a disk without a table as one file system, with bare paths", async () => {
    const disk = await openDisk(memorySource(image("fat16.img")));
    expect(detail(disk, "File system")).toBe("FAT16");
    expect(detail(disk, "Label")).toBe("FATSIXTEEN");
    expect(utf8(await disk.read(entry(disk, "hello.txt")))).toBe("Hello, disks!\n");
  });

  it.each(CONTAINERS.map(([name]) => name))("%s lists the same files as the raw disk", async (name) => {
    const raw = await openDisk(memorySource(image("gpt.img")));
    const disk = await openDisk(memorySource(image(name)));
    expect(detail(disk, "Virtual size")).toMatch(/12 MiB/);
    expect(paths(disk)).toEqual(paths(raw));
    const notes = entry(disk, "rootfs/home/example/notes.txt");
    expect(sha(await disk.read(notes))).toBe(sha(await raw.read(entry(raw, notes.path))));
  });

  it("reads the tables and directories, not the whole disk", async () => {
    const { source, counter } = counted(image("gpt-dynamic.vhdx"));
    const disk = await openDisk(source);
    expect(disk.entries.length).toBeGreaterThan(8);
    expect(counter.bytes).toBeLessThan(image("gpt-dynamic.vhdx").length / 2);
  });
});
