// WIM: a file wimcapture wrote, and WIMs from the test writer (stored, XPRESS, LZX; two images with
// a deep folder, a link, an empty file, streams and a file of several chunks), listed and read to
// the byte; LZMS, solid and split WIMs refused with their sentences; damage and cancels.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Archive } from "../../lib/disk/archive.js";
import { memorySource, type Source } from "../../lib/disk/source.js";
import { Work } from "../../lib/disk/work.js";
import { openWim } from "../../lib/packs/wim.js";
import { compressionOf, Resources, resourceAt } from "../../lib/packs/wim-resource.js";
import { mixed, text } from "./samples";
import { buildWim, DATE, type Image, type Options } from "./wim-builder";

const sample = () =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "sample.wim")));
const sha1 = (b: Uint8Array) => createHash("sha1").update(b).digest("hex");
const entry = (a: Archive, path: string) => {
  const found = a.entries.find((e) => e.path === path);
  if (!found) throw new Error(`no ${path} in ${a.entries.map((e) => e.path).join(", ")}`);
  return found;
};
const detail = (a: Archive, label: string) => a.details.find((d) => d.label === label)?.value;
/** A source over the bytes that counts the bytes read. */
function counted(bytes: Uint8Array) {
  const memory = memorySource(bytes);
  const count = { bytes: 0 };
  const source: Source = {
    size: memory.size,
    read: (offset, length) => {
      count.bytes += Math.max(0, Math.min(length, memory.size - offset));
      return memory.read(offset, length);
    },
  };
  return { source, count };
}

/** Every resource in the lookup table decodes to bytes with the SHA-1 it is filed under. */
async function checkHashes(bytes: Uint8Array) {
  const head = bytes.subarray(0, 208);
  const flags = new DataView(head.buffer, head.byteOffset).getUint32(16, true);
  const chunk = new DataView(head.buffer, head.byteOffset).getUint32(20, true) || 32768;
  const resources = new Resources(memorySource(bytes), compressionOf(flags), chunk);
  const lookup = resourceAt(head, 48);
  let checked = 0;
  for (let o = lookup.offset; o < lookup.offset + lookup.original; o += 50) {
    const res = resourceAt(bytes, o);
    const data = await resources.read(res, 0, res.original, new Work());
    expect(sha1(data)).toBe(Buffer.from(bytes.subarray(o + 30, o + 50)).toString("hex"));
    checked++;
  }
  return checked;
}

const BIG = mixed(100000, 30000, 5);
const IMAGES: Image[] = [
  {
    name: "Sample",
    description: "First & best",
    root: [
      { name: "readme.md", data: text(300) },
      { name: "empty.txt", data: new Uint8Array(0) },
      { name: "big.bin", data: BIG },
      {
        name: "a",
        dir: [
          {
            name: "b",
            dir: [
              { name: "c", dir: [{ name: "d", dir: [{ name: "deep.txt", data: text(50, 9) }] }] },
            ],
          },
        ],
      },
      { name: "link-to-readme", link: "readme.md" },
      { name: "up", link: "../a/b", relative: true },
      {
        name: "streams.txt",
        data: text(80, 3),
        ads: [{ name: "Zone.Identifier", data: text(20, 4) }],
      },
      { name: "nothing", dir: [] },
    ],
  },
  { name: "Second", root: [{ name: "한글.txt", data: new TextEncoder().encode("안녕하세요\n") }] },
];

describe("a WIM wimcapture wrote", () => {
  it("lists both images and reads their files to the byte", async () => {
    const wim = await openWim(memorySource(sample()));
    expect(wim.format).toBe("WIM");
    expect(wim.entries.map((e) => `${e.kind} ${e.path} ${e.size}`)).toEqual([
      "folder 1 Sample 0",
      "file 1 Sample/readme.md 56",
      "file 1 Sample/한글.txt 16",
      "folder 2 Second 0",
      "file 2 Second/readme.md 56",
      "file 2 Second/한글.txt 16",
    ]);
    expect(new TextDecoder().decode(await wim.read(entry(wim, "2 Second/readme.md")))).toBe(
      "# Sample\n\nA small tree for the archives plugin's tests.\n",
    );
    expect(new TextDecoder().decode(await wim.read(entry(wim, "1 Sample/한글.txt")))).toBe(
      "안녕하세요\n",
    );
    expect(entry(wim, "1 Sample/readme.md").date?.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect([detail(wim, "Images"), detail(wim, "Compression"), detail(wim, "Image 2")]).toEqual([
      "2",
      "LZX",
      "Second",
    ]);
  });

  it("decodes its LZX metadata to the SHA-1 the lookup table files it under", async () => {
    expect(await checkHashes(sample())).toBe(4);
  });
});

describe.each(["none", "xpress", "lzx"] as const)(
  "a %s WIM from the test writer",
  (compression) => {
    const options: Options = {
      compression,
      images: IMAGES,
      lzxKinds: ["aligned", "verbatim"],
      lzxBlockBytes: 20000,
    };
    const { bytes } = buildWim(options);

    it("lists every image as a folder of its files, folders and links", async () => {
      const wim = await openWim(memorySource(bytes));
      const listed = wim.entries.map((e) => `${e.kind} ${e.path}`);
      expect(listed).toEqual([
        "folder 1 Sample",
        "file 1 Sample/readme.md",
        "file 1 Sample/empty.txt",
        "file 1 Sample/big.bin",
        "folder 1 Sample/a",
        "link 1 Sample/link-to-readme",
        "link 1 Sample/up",
        "file 1 Sample/streams.txt",
        "folder 1 Sample/nothing",
        "folder 1 Sample/a/b",
        "folder 1 Sample/a/b/c",
        "folder 1 Sample/a/b/c/d",
        "file 1 Sample/a/b/c/d/deep.txt",
        "folder 2 Second",
        "file 2 Second/한글.txt",
      ]);
      expect(entry(wim, "1 Sample/link-to-readme").link).toBe("readme.md");
      expect(entry(wim, "1 Sample/up").link).toBe("../a/b");
      expect(entry(wim, "1 Sample/big.bin")).toMatchObject({ size: BIG.length, date: DATE });
      expect(entry(wim, "1 Sample/big.bin").method).toBe(
        { none: "None", xpress: "XPRESS", lzx: "LZX" }[compression],
      );
      expect(detail(wim, "Image 1")).toBe("Sample (First & best)");
      expect(wim.refusal).toBeUndefined();
    });

    it("reads every file to the byte, and only the chunks a read needs", async () => {
      const { source, count } = counted(bytes);
      const wim = await openWim(source);
      expect(count.bytes).toBeLessThan(
        bytes.length - (compression === "none" ? BIG.length : 20000),
      );
      const flat = new Map<string, Uint8Array>();
      const walk = (nodes: Image["root"], at: string) => {
        for (const n of nodes) {
          if ("dir" in n) walk(n.dir, `${at}/${n.name}`);
          else if ("data" in n) flat.set(`${at}/${n.name}`, n.data);
        }
      };
      IMAGES.forEach((im, i) => {
        walk(im.root, `${i + 1} ${im.name}`);
      });
      for (const [path, data] of flat)
        expect(sha1(await wim.read(entry(wim, path)))).toBe(sha1(data));
      const before = count.bytes;
      const head = await wim.read(entry(wim, "1 Sample/big.bin"), 10);
      expect(head).toEqual(BIG.subarray(0, 10));
      expect(count.bytes - before).toBeLessThan(compression === "none" ? 11 : 32768 + 12);
      expect(new TextDecoder().decode(await wim.read(entry(wim, "1 Sample/up")))).toBe("../a/b");
      await expect(wim.read(entry(wim, "1 Sample/a"))).rejects.toThrow("“1 Sample/a” is a folder.");
    });

    it("files every resource under the SHA-1 of its decoded bytes", async () => {
      expect(await checkHashes(bytes)).toBeGreaterThan(8);
    });
  },
);

describe("refusals", () => {
  const LZMS = "LZMS compression is not read yet.";

  it("lists an LZMS WIM's images and refuses the rest with its sentence", async () => {
    const wim = await openWim(
      memorySource(buildWim({ compression: "lzms", images: IMAGES }).bytes),
    );
    expect(wim.entries.map((e) => e.path)).toEqual(["1 Sample", "2 Second"]);
    expect(wim.refusal).toBe(LZMS);
    expect(wim.note).toBe(LZMS);
    expect(detail(wim, "Compression")).toBe("LZMS");
  });

  it("lists the files of solid resources and refuses to read them", async () => {
    const wim = await openWim(
      memorySource(buildWim({ compression: "xpress", images: IMAGES, solid: true }).bytes),
    );
    const big = entry(wim, "1 Sample/big.bin");
    expect(big).toMatchObject({ refusal: LZMS, method: "LZMS", size: BIG.length });
    await expect(wim.read(big)).rejects.toThrow(LZMS);
  });

  it("refuses split WIMs", async () => {
    const bytes = buildWim({ compression: "none", images: IMAGES, parts: 2 }).bytes;
    await expect(openWim(memorySource(bytes))).rejects.toThrow(
      /^Split WIMs \(\.swm\) are not read/,
    );
  });
});

describe("damage and cancels", () => {
  const { bytes } = buildWim({ compression: "lzx", images: IMAGES });

  it("fails with a sentence on damaged structures", async () => {
    await expect(openWim(memorySource(new Uint8Array(300)))).rejects.toThrow(
      "This is not a WIM image.",
    );
    const lookup = bytes.slice();
    lookup[64] = 7; // the lookup table's original size, no longer a whole number of entries
    await expect(openWim(memorySource(lookup))).rejects.toThrow(
      /^The WIM lookup table is damaged: /,
    );
    await expect(openWim(memorySource(bytes.subarray(0, bytes.length - 3000)))).rejects.toThrow(
      /^The WIM is cut short: /,
    );
    const plain = buildWim({ compression: "none", images: IMAGES });
    const meta = plain.bytes.slice();
    const at = Buffer.from(meta).indexOf(Buffer.from(plain.metas[0] as Uint8Array));
    meta[at + 8 + 5] = 0xff; // the root entry's length, now past the end
    await expect(openWim(memorySource(meta))).rejects.toThrow(
      /^The WIM metadata of image 1 is damaged: /,
    );
    meta[at + 8 + 5] = 0;
    meta.set([8, 0, 0, 0, 0, 0, 0, 0], at + 8 + 16); // the root's children: the root itself
    await expect(openWim(memorySource(meta))).rejects.toThrow(
      /^The WIM metadata of image 1 is damaged: /,
    );
  });

  it("fails with a sentence on a damaged chunk", async () => {
    const lookup = resourceAt(bytes, 48);
    let big = resourceAt(bytes, lookup.offset);
    for (let o = lookup.offset; o < lookup.offset + lookup.original; o += 50)
      if (resourceAt(bytes, o).original === BIG.length) big = resourceAt(bytes, o);
    const damaged = bytes.slice();
    for (let i = big.offset + 12 + 50; i < big.offset + 12 + 250; i++)
      damaged[i] = (damaged[i] ?? 0) ^ 0x5a;
    const wim = await openWim(memorySource(damaged));
    const start = performance.now();
    await expect(wim.read(entry(wim, "1 Sample/big.bin"))).rejects.toThrow(
      /^The LZX data is damaged: /,
    );
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("stops when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(openWim(memorySource(bytes), { signal: controller.signal })).rejects.toMatchObject(
      { name: "AbortError" },
    );
    const wim = await openWim(memorySource(bytes));
    await expect(
      wim.read(entry(wim, "1 Sample/big.bin"), Infinity, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("gives the event loop a turn while it lists many files", async () => {
    const files = Array.from({ length: 60 }, (_, d) => ({
      name: `folder ${d}`,
      dir: Array.from({ length: 100 }, (_, f) => ({
        name: `file ${f}.txt`,
        data: text(20 + f, d * 100 + f),
      })),
    }));
    const many = buildWim({ compression: "lzx", images: [{ name: "Many", root: files }] });
    let worst = 0;
    let last = performance.now();
    let done = false;
    const beat = () => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
      if (!done) setTimeout(beat, 0);
    };
    setTimeout(beat, 0);
    const wim = await openWim(memorySource(many.bytes));
    done = true;
    expect(wim.entries.length).toBe(1 + 60 + 6000);
    expect(worst).toBeLessThan(100);
  }, 60000);

  it("gives the event loop a turn while it reads a large file", async () => {
    const large = mixed(3 << 20, 30000, 8);
    const big = buildWim({
      compression: "xpress",
      images: [{ name: "Big", root: [{ name: "large.bin", data: large }] }],
    });
    const wim = await openWim(memorySource(big.bytes));
    let worst = 0;
    let last = performance.now();
    let done = false;
    const beat = () => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
      if (!done) setTimeout(beat, 0);
    };
    setTimeout(beat, 0);
    const read = await wim.read(entry(wim, "1 Big/large.bin"));
    done = true;
    expect(sha1(read)).toBe(sha1(large));
    expect(worst).toBeLessThan(100);
  }, 60000);
});
