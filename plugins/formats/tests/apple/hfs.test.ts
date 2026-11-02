import { describe, expect, it } from "vitest";
import { openDmg, openHfs, openUdif } from "../../lib/apple/index.js";
import { readTable } from "../../lib/disk/partitions.js";
import { memorySource, type Source, sliceSource } from "../../lib/disk/source.js";
import { Work } from "../../lib/disk/work.js";
import { counted, detail, entry, expected, fixture, matches, paths, sha, utf8 } from "./fixtures";

const UDZO = expected.hfs.formats.UDZO ?? "";
const want = expected.hfs.volumes["Apple HFS"] ?? [];
const of = (path: string) => want.find((e) => e.path === path);

/** The HFS+ partition of the GPT disk, as its own bytes. */
async function volume() {
  const { disk } = await openUdif(fixture(UDZO));
  const table = await readTable(disk, new Work());
  const p = table?.partitions[0];
  if (!p) throw new Error("no partition");
  return new Uint8Array(await sliceSource(disk, p.start, p.size).read(0, p.size));
}

describe("HFS+", () => {
  it("lists every file, folder and link the kernel lists, and reads their bytes", async () => {
    const dmg = await openDmg(fixture(UDZO));
    expect(await matches(dmg, want)).toEqual([]);
    expect(detail(dmg, "File system")).toBe("HFS+");
    expect(detail(dmg, "Label")).toBe("Apple HFS");
    expect(detail(dmg, "Journaled")).toBe("no");
  });

  it("follows a deep folder, a hard link and symlinks", async () => {
    const dmg = await openDmg(fixture(UDZO));
    const deep = entry(dmg, "deep/one/two/three/four/five/six/seven/eight/deep.txt");
    expect(utf8(await dmg.read(deep))).toBe("deep\n");
    const [a, b] = ["links/hard-a.txt", "links/hard-b.txt"].map((p) => entry(dmg, p));
    expect(of("links/hard-a.txt")?.inode).toBe(of("links/hard-b.txt")?.inode);
    expect(utf8(await dmg.read(a as never))).toBe("one file, two names\n");
    expect(utf8(await dmg.read(b as never))).toBe("one file, two names\n");
    expect(entry(dmg, "links/to-hello")).toMatchObject({ kind: "link", link: "../hello.txt" });
    expect(entry(dmg, "links/absolute")).toMatchObject({ kind: "link", link: "/etc/hosts" });
    expect(paths(dmg).filter((p) => p.includes("Private") || p.startsWith("\0"))).toEqual([]);
  });

  it("reads files kept compressed: ditto's and every decmpfs type, in the attribute or the fork", async () => {
    const dmg = await openDmg(fixture(UDZO));
    const methods = Object.fromEntries(
      dmg.entries.filter((e) => e.path.startsWith("compressed/")).map((e) => [e.path, e.method]),
    );
    expect(methods).toEqual({
      "compressed/ditto.txt": "LZVN (decmpfs)",
      "compressed/type-03.txt": "zlib (decmpfs)",
      "compressed/type-04.txt": "zlib (decmpfs)",
      "compressed/type-07.txt": "LZVN (decmpfs)",
      "compressed/type-08.txt": "LZVN (decmpfs)",
      "compressed/type-11.txt": "LZFSE (decmpfs)",
      "compressed/type-12.txt": "LZFSE (decmpfs)",
    });
    for (const path of Object.keys(methods)) {
      expect(of(path)?.compressed, path).toBe(true);
      expect(sha(await dmg.read(entry(dmg, path))), path).toBe(of(path)?.sha256);
    }
  });

  it("reads a file in more extents than its catalog record holds", async () => {
    const bytes = await volume();
    const view = new DataView(bytes.buffer);
    const block = view.getUint32(1024 + 40);
    const extentsFile = view.getUint32(1024 + 192 + 16) * block;
    expect(
      view.getUint32(extentsFile + 14 + 6),
      "records in the extents-overflow file",
    ).toBeGreaterThan(0);
    const fs = await openHfs(memorySource(bytes));
    const file = entry(fs, "data/fragmented.bin");
    expect(sha(await fs.read(file))).toBe(of("data/fragmented.bin")?.sha256);
  });

  it("opens the bare volume, and reads only the first bytes asked for", async () => {
    const bytes = await volume();
    const { source, counter } = counted(bytes);
    const fs = await openHfs(source);
    expect(fs.format).toBe("HFS+");
    expect(paths(fs)).toEqual(want.map((e) => e.path).sort());
    const before = counter.bytes;
    const head = await fs.read(entry(fs, "compressed/type-12.txt"), 100);
    expect(utf8(head)).toMatch(/^type 12 block 000000/);
    expect(counter.bytes - before).toBeLessThan(64 * 1024);
    expect((await fs.read(entry(fs, "data/pattern.bin"), 10)).length).toBe(10);
  });
});

describe("HFSX", () => {
  it("keeps names that differ only by case apart and hides the journal", async () => {
    const dmg = await openDmg(fixture(expected.hfsx.file));
    expect(await matches(dmg, expected.hfsx.volumes["Apple HFSX"] ?? [])).toEqual([]);
    expect(detail(dmg, "File system")).toBe("HFSX");
    expect(detail(dmg, "Case-sensitive")).toBe("yes");
    expect(detail(dmg, "Journaled")).toBe("yes");
    expect(utf8(await dmg.read(entry(dmg, "README.txt")))).toBe("upper case\n");
  });
});

describe("damage and cancelling", () => {
  /** The bare volume with the catalog's header node zeroed, or its leaves linked in a loop. */
  async function damaged(how: "header" | "loop"): Promise<Source> {
    const bytes = await volume();
    const view = new DataView(bytes.buffer);
    const block = view.getUint32(1024 + 40);
    const catalog = view.getUint32(1024 + 272 + 16) * block;
    if (how === "header") bytes.fill(0, catalog, catalog + 512);
    else {
      // The first leaf's forward link, pointing at itself: the node's place through the extents.
      const first = view.getUint32(catalog + 14 + 10);
      let offset = first * view.getUint16(catalog + 14 + 18);
      for (let i = 0; ; i++) {
        const length = view.getUint32(1024 + 272 + 20 + 8 * i) * block;
        if (offset < length) {
          view.setUint32(view.getUint32(1024 + 272 + 16 + 8 * i) * block + offset, first);
          break;
        }
        offset -= length;
      }
    }
    return memorySource(bytes);
  }

  it("fails with a sentence when the catalog does not hold together", async () => {
    await expect(openHfs(await damaged("header"))).rejects.toThrow(
      "The HFS+ catalog file is damaged: its header node is missing.",
    );
    await expect(openHfs(await damaged("loop"))).rejects.toThrow(/leaves link in a loop/);
  });

  it("stops when the signal fires", async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(openHfs(memorySource(await volume()), { signal: stop.signal })).rejects.toThrow(
      /cancel|abort/i,
    );
    const fs = await openHfs(memorySource(await volume()));
    await expect(
      fs.read(entry(fs, "hello.txt"), undefined, { signal: stop.signal }),
    ).rejects.toThrow(/cancel|abort/i);
  });
});
