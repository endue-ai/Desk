import { describe, expect, it } from "vitest";
import { openDmg, openUdif } from "../../lib/apple/index.js";
import { ENCRYPTED } from "../../lib/apple/udif.js";
import { memorySource } from "../../lib/disk/source.js";
import { buildUdif } from "./build-udif";
import {
  bytes,
  copy,
  counted,
  detail,
  expected,
  fixture,
  matches,
  paths,
  sha,
  sourceHash,
} from "./fixtures";

const FORMATS = Object.entries(expected.hfs.formats);

describe.each(FORMATS)("%s", (format, name) => {
  it("gives the disk hdiutil wrote, byte for byte", async () => {
    const image = await openUdif(fixture(name));
    expect(image.format).toBe(`Apple disk image (${format})`);
    expect(detail(image, "Format")).toContain(`(${format})`);
    expect(image.disk.size).toBe(expected.hfs.disk.size);
    expect(await sourceHash(image.disk)).toBe(expected.hfs.disk.sha256);
  });

  it("opens as the files of its HFS+ volume", async () => {
    const dmg = await openDmg(fixture(name));
    expect(detail(dmg, "Partition table")).toBe("GPT");
    expect(await matches(dmg, expected.hfs.volumes["Apple HFS"] ?? [])).toEqual([]);
  });
});

describe("partition maps and bare volumes", () => {
  it("reads an Apple Partition Map", async () => {
    const image = await openUdif(fixture(expected.apm.file));
    expect(await sourceHash(image.disk)).toBe(expected.apm.disk.sha256);
    const dmg = await openDmg(fixture(expected.apm.file));
    expect(detail(dmg, "Partition table")).toBe("Apple Partition Map");
    expect(detail(dmg, "Partition 2")).toMatch(/Apple_HFS.*HFS\+ “Apple APM”/);
    expect(await matches(dmg, expected.apm.volumes["Apple APM"] ?? [])).toEqual([]);
  });

  it("reads a disk with no partition map, one volume from sector 0", async () => {
    const image = await openUdif(fixture(expected.hfsx.file));
    expect(await sourceHash(image.disk)).toBe(expected.hfsx.disk.sha256);
    const dmg = await openDmg(fixture(expected.hfsx.file));
    expect(detail(dmg, "Partition table")).toBeUndefined();
    expect(detail(dmg, "File system")).toBe("HFSX");
  });

  it("gives the APFS disk byte for byte", async () => {
    const image = await openUdif(fixture(expected.apfs.file));
    expect(await sourceHash(image.disk)).toBe(expected.apfs.disk.sha256);
  });

  it("reads block tables kept in an old resource fork, and raw chunks", async () => {
    const disk = (
      await (await openUdif(fixture(expected.hfsx.file))).disk.read(0, 1 << 20)
    ).slice();
    for (const method of ["zlib", "raw"]) {
      const { image } = buildUdif(disk, { fork: true, sectors: 64, method });
      const opened = await openUdif(memorySource(image));
      expect(opened.format).toBe(
        method === "raw" ? "Apple disk image (UDRO)" : "Apple disk image (UDZO)",
      );
      expect(sha(await opened.disk.read(0, disk.length))).toBe(sha(disk));
      expect(detail(await openDmg(memorySource(image)), "File system")).toBe("HFSX");
    }
  });

  it("takes a file without a UDIF trailer as a raw disk", async () => {
    const raw = await sourceHash((await openUdif(fixture(expected.hfs.formats.UDRO ?? ""))).disk);
    const disk = new Uint8Array(expected.hfs.disk.size);
    disk.set(
      await (await openUdif(fixture(expected.hfs.formats.UDZO ?? ""))).disk.read(0, disk.length),
    );
    const image = await openUdif(memorySource(disk));
    expect(image.format).toBe("Disk image");
    expect(await sourceHash(image.disk)).toBe(raw);
    const dmg = await openDmg(memorySource(disk));
    expect(paths(dmg)).toEqual(paths(await openDmg(fixture(expected.hfs.formats.UDZO ?? ""))));
  });
});

describe("refusals", () => {
  it("refuses an encrypted image with its sentence", async () => {
    const dmg = await openDmg(fixture(expected.encrypted.file));
    expect(dmg.entries).toEqual([]);
    expect(dmg.refusal).toBe(ENCRYPTED);
    expect(dmg.note).toBe(ENCRYPTED);
    expect(dmg.format).toMatch(/encrypted/);
    expect(detail(dmg, "Image size")).toMatch(/KiB/);
    await expect(dmg.read({ path: "hello.txt", kind: "file", size: 1 })).rejects.toThrow(ENCRYPTED);
    await expect(openUdif(fixture(expected.encrypted.file))).rejects.toThrow(ENCRYPTED);
  });

  it("refuses a split image and a sparse one", async () => {
    const split = copy(expected.hfs.formats.UDZO ?? "");
    split[split.length - 512 + 63] = 2;
    expect((await openDmg(memorySource(split))).refusal).toMatch(/split into 2 segments/);
    const sparse = new Uint8Array(4096);
    sparse.set([0x73, 0x70, 0x72, 0x73]);
    expect((await openDmg(memorySource(sparse))).refusal).toMatch(/Sparse disk images/);
  });
});

describe("damage", () => {
  const udzo = expected.hfs.formats.UDZO ?? "";

  it("fails on a property list that does not parse", async () => {
    const image = copy(udzo);
    const text = new TextDecoder("latin1").decode(image);
    const at = text.lastIndexOf("<key>blkx</key>");
    image[at + 1] = 0x3f; // "<?ey>"
    await expect(openDmg(memorySource(image))).rejects.toThrow(/property list is damaged/);
  });

  it("fails on a block table that is not one", async () => {
    const { image } = buildUdif(bytes(expected.hfs.formats.UDRO ?? "").subarray(0, 1 << 20));
    const text = new TextDecoder("latin1").decode(image);
    const at = text.indexOf("<data>") + 6;
    const data = text.indexOf("bWlza", at); // "mish" in base64
    image[data] = 0x63; // "c"
    await expect(openUdif(memorySource(image))).rejects.toThrow(/does not start with “mish”/);
  });

  it("fails on a chunk that does not decode, naming its sector", async () => {
    const disk = new Uint8Array(4 << 20).map((_, i) => (i * 7) & 0xff);
    const { image, chunks } = buildUdif(disk);
    const second = chunks[1] ?? { at: 0, length: 0, sector: 0 };
    image.fill(0x55, second.at + 2, second.at + 40);
    const opened = await openUdif(memorySource(image));
    expect(await opened.disk.read(0, 512)).toEqual(disk.subarray(0, 512));
    await expect(opened.disk.read(second.sector * 512, 512)).rejects.toThrow(
      `The disk image is damaged: its zlib chunk at sector ${second.sector} does not decode`,
    );
  });

  it("fails when the image is cut short", async () => {
    const image = bytes(udzo);
    const cut = new Uint8Array(image.length - 4096);
    cut.set(image.subarray(0, 8192));
    cut.set(image.subarray(image.length - (cut.length - 8192)), 8192);
    await expect(openDmg(memorySource(cut))).rejects.toThrow(/damaged|cut short/);
  });
});

describe("reading by ranges", () => {
  it("reads only the trailer, the list and the chunks asked for", async () => {
    const disk = new Uint8Array(256 << 20);
    for (let i = 0; i < 8; i++) disk.fill(i + 1, i * (32 << 20), i * (32 << 20) + 4096);
    const { image } = buildUdif(disk);
    const { source, counter } = counted(image);
    const opened = await openUdif(source);
    expect(counter.bytes).toBeLessThan(64 * 1024);
    const before = counter.bytes;
    const got = await opened.disk.read(3 * (32 << 20), 8192);
    expect(got.subarray(0, 4096).every((b) => b === 4)).toBe(true);
    expect(got.subarray(4096).every((b) => b === 0)).toBe(true);
    expect(counter.bytes - before).toBeLessThan(16 * 1024);
    expect(await opened.disk.read((200 << 20) + 5, 100)).toEqual(new Uint8Array(100));
  });

  it("reads a raw chunk's sectors straight from the image", async () => {
    const { source, counter } = counted(bytes(expected.hfs.formats.UDRO ?? ""));
    const opened = await openUdif(source);
    const before = counter.reads;
    const sector = await opened.disk.read(40 * 512 + 1024, 512);
    expect(sector[0]).toBe(0x48); // "H+"
    expect(counter.reads - before).toBe(1);
  });

  it("gives the event loop a turn while it decodes, and stops when cancelled", async () => {
    const disk = new Uint8Array(96 << 20).map((_, i) => (i >> 9) & 0xff);
    const { image } = buildUdif(disk);
    const opened = await openUdif(memorySource(image));
    let turns = 0;
    const timer = setInterval(() => turns++, 1);
    const started = Date.now();
    const all = await opened.disk.read(0, disk.length);
    clearInterval(timer);
    expect(sha(all)).toBe(sha(disk));
    expect(turns).toBeGreaterThan((Date.now() - started) / 60);
    const stop = new AbortController();
    stop.abort();
    await expect(openDmg(memorySource(image), { signal: stop.signal })).rejects.toThrow(
      /cancel|abort/i,
    );
  });
});
