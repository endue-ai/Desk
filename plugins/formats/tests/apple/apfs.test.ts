import { describe, expect, it } from "vitest";
import { openApfs, openDmg, openUdif } from "../../lib/apple/index.js";
import type { Archive } from "../../lib/disk/archive.js";
import { readTable } from "../../lib/disk/partitions.js";
import { memorySource, type Source } from "../../lib/disk/source.js";
import { Work } from "../../lib/disk/work.js";
import { counted, detail, entry, expected, fixture, matches, sha, utf8 } from "./fixtures";

const want = expected.apfs.volumes["Apple APFS"] ?? [];
const METHODS: Record<string, RegExp> = {
  "compressed/type-03.txt": /^zlib \(decmpfs\)$/,
  "compressed/type-04.txt": /^zlib \(decmpfs\)$/,
  "compressed/type-07.txt": /^LZVN \(decmpfs\)$/,
  "compressed/type-08.txt": /^LZVN \(decmpfs\)$/,
  "compressed/type-11.txt": /^LZFSE \(decmpfs\)$/,
  "compressed/type-12.txt": /^LZFSE \(decmpfs\)$/,
  "compressed/ditto.txt": /^(zlib|LZVN|LZFSE) \(decmpfs\)$/,
};

/** The APFS container's bytes: the GPT partition of the disk inside the DMG. */
async function container(name: string) {
  const image = await openUdif(fixture(name));
  const table = await readTable(image.disk, new Work());
  const partition = table?.partitions.find((p) => p.type === "Apple APFS");
  if (!partition) throw new Error(`no APFS partition in ${name}`);
  return (await image.disk.read(partition.start, partition.size)).slice();
}

/** Each block of the container whose header says it is `type` (with `subtype`, when given). */
function blocks(bytes: Uint8Array, type: number, subtype?: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: number[] = [];
  for (let at = 0; at + 4096 <= bytes.length; at += 4096) {
    const t = view.getUint32(at + 24, true) & 0xffff;
    if (t === type && (subtype === undefined || view.getUint32(at + 28, true) === subtype))
      found.push(at);
  }
  return found;
}

describe("APFS in a DMG", () => {
  it("lists every file, folder and link the kernel sees, with sizes, dates and exact bytes", async () => {
    const archive = await openDmg(fixture(expected.apfs.file));
    expect(want.length).toBeGreaterThan(80);
    expect(await matches(archive, want)).toEqual([]);
  });

  it("names the volume in its details", async () => {
    const archive = await openDmg(fixture(expected.apfs.file));
    expect(detail(archive, "File system")).toBe("APFS");
    expect(detail(archive, "Label")).toBe("Apple APFS");
    expect(detail(archive, "Case sensitivity")).toBe("Case-insensitive");
    expect(detail(archive, "Used")).toMatch(/KiB|MiB/);
  });

  it("reads every decmpfs file exactly, and names its method", async () => {
    const archive = await openDmg(fixture(expected.apfs.file));
    const compressed = want.filter((e) => e.compressed);
    expect(compressed.map((e) => e.path).sort()).toEqual(Object.keys(METHODS).sort());
    for (const file of compressed) {
      const found = entry(archive, file.path);
      expect(found.method, file.path).toMatch(METHODS[file.path] as RegExp);
      expect(found.size, file.path).toBe(file.size);
      expect(sha(await archive.read(found)), file.path).toBe(file.sha256);
      const head = await archive.read(found, 100);
      expect(head.length, file.path).toBe(Math.min(100, file.size));
      expect(sha(head), file.path).toBe(sha((await archive.read(found)).subarray(0, 100)));
    }
  });

  it("reads hard links, symlinks and a sparse file", async () => {
    const archive = await openDmg(fixture(expected.apfs.file));
    const a = await archive.read(entry(archive, "links/hard-a.txt"));
    expect(utf8(a)).toBe("one file, two names\n");
    expect(await archive.read(entry(archive, "links/hard-b.txt"))).toEqual(a);
    expect(entry(archive, "links/to-hello")).toMatchObject({ kind: "link", link: "../hello.txt" });
    const sparse = await archive.read(entry(archive, "data/sparse.bin"));
    expect(sparse.length).toBe(1024 * 1024 + 4096);
    expect(sparse.subarray(4096, 1024 * 1024).every((b) => b === 0)).toBe(true);
    expect(utf8(sparse.subarray(1024 * 1024, 1024 * 1024 + 17))).toBe("sparse tail block");
  });
});

describe("APFS as a bare container", () => {
  it("opens the container itself and lists the same files", async () => {
    const archive = await openApfs(memorySource(await container(expected.apfs.file)));
    expect(archive.format).toBe("APFS");
    expect(detail(archive, "Container")).toMatch(/^APFS, 8\.0 MiB/);
    expect(detail(archive, "Block size")).toMatch(/^4\.0 KiB/);
    expect(detail(archive, "Volumes")).toBe("1");
    expect(detail(archive, "Volume 1")).toMatch(/^“Apple APFS”, \d+ KiB used, case-insensitive$/);
    expect(await matches(archive, want)).toEqual([]);
  });

  it("reads only what a limited read needs", async () => {
    const bytes = await container(expected.apfs.file);
    /** The source bytes one read takes, on a container opened afresh (no block cached yet). */
    const cost = async (path: string, limit?: number) => {
      const { source, counter } = counted(bytes);
      const archive = await openApfs(source);
      const before = counter.bytes;
      const data = await archive.read(entry(archive, path), limit);
      return { data, bytes: counter.bytes - before };
    };
    for (const path of ["data/pattern.bin", "compressed/ditto.txt", "compressed/type-12.txt"]) {
      const head = await cost(path, 10);
      const whole = await cost(path);
      expect(head.data, path).toEqual(whole.data.subarray(0, 10));
      // The compressed forks are small enough to sit in one cached block of 16 KiB.
      if (path.startsWith("data/")) expect(head.bytes, path).toBeLessThan(whole.bytes);
      else expect(head.bytes, path).toBeLessThanOrEqual(whole.bytes);
    }
    const sparse = await cost("data/sparse.bin", 4096);
    expect(sparse.data.length).toBe(4096);
    expect(sparse.bytes).toBeLessThanOrEqual(16 * 1024);
  });

  it("stops listing when its signal is aborted", async () => {
    const bytes = await container(expected.apfs.file);
    const controller = new AbortController();
    const memory = memorySource(bytes);
    let reads = 0;
    const source: Source = {
      size: memory.size,
      read: (offset, length) => {
        if (++reads === 6) controller.abort();
        return memory.read(offset, length);
      },
    };
    await expect(openApfs(source, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(
      openApfs(memorySource(bytes), { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("APFS that is not read", () => {
  it("refuses an encrypted volume with its sentence and lists nothing from it", async () => {
    const sentence = "The volume “Locked” is encrypted: it is not read here.";
    const archive: Archive = await openDmg(fixture(expected["apfs-locked"].file));
    expect(archive.entries).toEqual([]);
    expect(archive.note).toBe(sentence);
    await expect(archive.read({ path: "secret.txt", kind: "file", size: 1 })).rejects.toThrow();
    const bare = await openApfs(memorySource(await container(expected["apfs-locked"].file)));
    expect(bare.entries).toEqual([]);
    expect(bare.note).toBe(sentence);
    expect(detail(bare, "Volume 1")).toBe("“Locked”, encrypted: not read here");
  });

  it("fails with a sentence when no checkpoint holds together", async () => {
    const bytes = await container(expected.apfs.file);
    const superblocks = blocks(bytes, 1);
    expect(superblocks.length).toBeGreaterThan(1);
    for (const at of superblocks) bytes.fill(0, at, at + 8);
    await expect(openApfs(memorySource(bytes))).rejects.toThrow(
      "The APFS container is damaged: no checkpoint holds together.",
    );
  });

  it("fails with a sentence when a file-system tree node is damaged", async () => {
    const bytes = await container(expected.apfs.file);
    const nodes = [...blocks(bytes, 2, 0x0e), ...blocks(bytes, 3, 0x0e)];
    expect(nodes.length).toBeGreaterThan(0);
    for (const at of nodes) bytes[at + 2000] = (bytes[at + 2000] ?? 0) ^ 0xff;
    await expect(openApfs(memorySource(bytes))).rejects.toThrow(
      /^The APFS container is damaged: .* fails its checksum\.$/,
    );
  });

  it("fails with a sentence when the container superblock is gone", async () => {
    const bytes = await container(expected.apfs.file);
    bytes.fill(0, 0, 4096);
    await expect(openApfs(memorySource(bytes))).rejects.toThrow(
      "The APFS container is damaged: its superblock is missing.",
    );
  });
});
