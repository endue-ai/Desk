// RAR 5 archives made by RARLAB's rar 7.23 (make-fixtures.sh): every method level, stored, solid,
// a dictionary larger than RAR 4 allows, and the delta, E8 and E8E9 filters. Every entry's bytes
// and CRC match the original files.
import { describe, expect, it } from "vitest";
import { Fields } from "../../lib/rar/bytes.js";
import { crc32 } from "../../lib/rar/crc32.js";
import { list5 } from "../../lib/rar/rar5/headers.js";
import { Decoder5 } from "../../lib/rar/rar5/lz.js";
import {
  entry,
  expectOriginals,
  FEW,
  FOLDERS,
  fixture,
  LINK,
  memory,
  open,
  openFixture,
  original,
  TREE,
} from "./helpers";

describe("RAR 5", () => {
  for (const [level, method] of [
    [1, "Fastest"],
    [3, "Normal"],
    [5, "Best"],
  ] as const) {
    it(`decodes -m${level}: text, binary, empty and Unicode-named files`, async () => {
      const archive = await openFixture(`rar5-m${level}.rar`);
      expect(archive.format).toBe("RAR 5");
      await expectOriginals(archive, TREE);
      expect(entry(archive, "text.txt").method).toBe(method);
      expect(entry(archive, "text.txt").packed).toBeLessThan(original("text.txt").length / 2);
    });
  }

  it("lists names, folders, sizes, dates and links", async () => {
    const archive = await openFixture("rar5-m3.rar");
    const paths = archive.entries.map((e) => e.path).sort();
    expect(paths).toEqual([...TREE, ...FOLDERS, LINK[0]].sort());
    for (const folder of FOLDERS) expect(entry(archive, folder).kind).toBe("folder");
    const link = entry(archive, LINK[0]);
    expect(link).toMatchObject({ kind: "link", link: LINK[1], size: 0 });
    expect(new TextDecoder().decode(await archive.read(link))).toBe(LINK[1]);
    expect(entry(archive, "text.txt").date?.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(entry(archive, "text.txt").encrypted).toBeUndefined();
    expect(archive.details).toContainEqual({ label: "Solid", value: "No" });
  });

  it("reads stored entries straight from the archive", async () => {
    const archive = await openFixture("rar5-stored.rar");
    await expectOriginals(archive, FEW);
    expect(entry(archive, "data.bin")).toMatchObject({ method: "Stored", packed: 49152 });
  });

  it("decodes a solid archive in order, out of order and in one pass", async () => {
    const paths = [
      "chapters/one.txt",
      "chapters/two.txt",
      "chapters/three.txt",
      "text.txt",
      "data.bin",
      "tool.exe",
    ] as const;
    const archive = await openFixture("rar5-solid.rar");
    expect(archive.details).toContainEqual({ label: "Solid", value: "Yes" });
    await expectOriginals(archive, [...paths].reverse());
    await expectOriginals(await openFixture("rar5-solid.rar"), [...paths]);
    const seen: string[] = [];
    const again = await openFixture("rar5-solid.rar");
    await again.each(
      paths.map((p) => entry(again, p)),
      async (e, bytes) => {
        seen.push(e.path);
        expect(bytes).toEqual(original(e.path as (typeof paths)[number]));
      },
    );
    expect(seen.sort()).toEqual([...paths].sort());
  });

  it("decodes matches farther back than RAR 4's largest dictionary", async () => {
    const archive = await openFixture("rar5-dict.rar");
    const far = entry(archive, "far.bin");
    expect(far.packed).toBeLessThan(100 * 1024);
    await expectOriginals(archive, ["far.bin"]);
  });

  it("runs the E8E9, E8 and delta filters rar chose", async () => {
    const types = new Set<number>();
    const define = Decoder5.prototype.readFilter;
    Decoder5.prototype.readFilter = function (this: Decoder5, input) {
      define.call(this, input);
      types.add(this.filters.at(-1)?.type ?? -1);
    };
    try {
      await expectOriginals(await openFixture("rar5-filters.rar"), [
        "tool.exe",
        "tool-e8.exe",
        "table.dat",
      ]);
    } finally {
      Decoder5.prototype.readFilter = define;
    }
    expect([...types].sort()).toEqual([0, 1, 2]);
  });

  it("reads the first bytes of an entry without decoding the rest", async () => {
    const archive = await openFixture("rar5-m5.rar");
    const head = await archive.read(entry(archive, "text.txt"), 1000);
    expect(head).toEqual(original("text.txt").subarray(0, 1000));
  });

  it("finds an archive after a self-extracting module", async () => {
    for (const name of ["rar5-m3.rar", "rar4-m3.rar"]) {
      const stub = new Uint8Array(70000).fill(0x90);
      stub.set([0x4d, 0x5a]);
      const bytes = new Uint8Array(stub.length + fixture(name).length);
      bytes.set(stub);
      bytes.set(fixture(name), stub.length);
      const archive = await open(bytes);
      expect(archive.details).toContainEqual({ label: "Self-extracting", value: "Yes" });
      await expectOriginals(archive, ["text.txt", "docs/notes/readme.md"]);
    }
  });

  it("reports BLAKE2sp hashes as not checked", async () => {
    const archive = await openFixture("rar5-blake.rar");
    expect(archive.details).toContainEqual({ label: "Checksums", value: "BLAKE2sp, not checked" });
    await expectOriginals(archive, ["docs/notes/readme.md"]);
  });
});

/** Sets the dictionary-size bits of the first file header's compression information. */
function withDictionary(bytes: Uint8Array, bits: number) {
  const out = bytes.slice();
  let pos = 8;
  for (;;) {
    const lead = new Fields(out, pos + 4);
    const size = lead.vint();
    const f = new Fields(out, lead.pos, lead.pos + size);
    const type = f.vint();
    const flags = f.vint();
    if (flags & 1) f.vint();
    const data = flags & 2 ? f.vint() : 0;
    if (type === 2) {
      const fileFlags = f.vint();
      f.vint();
      f.vint();
      if (fileFlags & 2) f.u32();
      if (fileFlags & 4) f.u32();
      const at = f.pos;
      const info = (f.vint() & ~0x3c00) | (bits << 10);
      if (f.pos - at !== 2) throw new Error("expected a two-byte vint");
      out[at] = (info & 0x7f) | 0x80;
      out[at + 1] = info >> 7;
      new DataView(out.buffer).setUint32(pos, crc32(out.subarray(pos + 4, lead.pos + size)), true);
      return out;
    }
    pos = lead.pos + size + data;
  }
}

describe("RAR 5 dictionaries", () => {
  it("decodes with any dictionary size the header asks for, the ring no larger than the data", async () => {
    const rings: number[] = [];
    const file = Decoder5.prototype.file;
    Decoder5.prototype.file = function (this: Decoder5, ...args: Parameters<Decoder5["file"]>) {
      rings.push(this.win.length);
      return file.apply(this, args);
    };
    try {
      for (const bits of [0, 3, 7, 11, 15]) {
        const bytes = withDictionary(fixture("rar5-m3.rar"), bits);
        const { listed } = await list5(memory(bytes), 0);
        expect(listed[0]?.data?.dictionary).toBe(0x20000 * 2 ** bits);
        await expectOriginals(await open(bytes), ["text.txt"]);
      }
    } finally {
      Decoder5.prototype.file = file;
    }
    expect(Math.max(...rings)).toBeLessThanOrEqual(256 * 1024);
  });
});

describe("RAR 5 filters", () => {
  it("turns ARM branch targets back into relative ones", async () => {
    const { run, ARM } = await import("../../lib/rar/rar5/filters.js");
    const plain = new Uint8Array(4096);
    const view = new DataView(plain.buffer);
    for (let i = 0; i < plain.length; i += 4)
      view.setUint32(
        i,
        i % 12 === 0 ? (0xeb000000 | ((0x1000 - i) & 0xffffff)) >>> 0 : 0xe1a00000 + i,
        true,
      );
    const offset = 0x2000;
    const packed = plain.slice();
    const out = new DataView(packed.buffer);
    for (let i = 0; i < packed.length; i += 4) {
      if (packed[i + 3] !== 0xeb) continue;
      const target = ((view.getUint32(i, true) & 0xffffff) + (i + offset) / 4) & 0xffffff;
      out.setUint32(i, (0xeb000000 | target) >>> 0, true);
    }
    const win = new Uint8Array(1 << 16);
    win.set(packed, 100);
    const filtered = run(
      { start: 100, length: packed.length, type: ARM, channels: 0, offset },
      win,
    );
    expect(filtered).toEqual(plain);
  });
});
