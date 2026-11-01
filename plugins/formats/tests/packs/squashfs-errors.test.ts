// SquashFS refusals and damage: each fails with the one sentence a person reads (never a TypeError
// or a RangeError), fast; cancels stop open and read; long work gives the event loop its turns.
import { describe, expect, it } from "vitest";
import { memorySource } from "../../lib/disk/source.js";
import { openSquashfs } from "../../lib/packs/index.js";
import { mixed, random, text } from "./samples";
import { buildSquashfs, type SqDir } from "./squashfs-builder";
import { detail, entry, fixture, sampleTree, sha256, worstGap } from "./squashfs-tree";

const open = (bytes: Uint8Array) => openSquashfs(memorySource(bytes));
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset);
const image = (options = {}) => buildSquashfs(sampleTree(), { compressor: "gzip", ...options });

describe("refusals", () => {
  async function refused(bytes: Uint8Array, sentence: RegExp) {
    const fs = await open(bytes);
    expect(fs.entries).toEqual([]);
    expect(fs.note).toMatch(sentence);
    expect(fs.refusal).toMatch(sentence);
    await expect(fs.read({ path: "x", kind: "file", size: 1 })).rejects.toThrow(sentence);
    return fs;
  }

  it("refuses big-endian, older and legacy-LZMA images with their sentences", async () => {
    const be = image();
    be.set([0x73, 0x71, 0x73, 0x68], 0);
    await refused(be, /^Big-endian SquashFS images \(version 3 and older\) are not read\.$/);
    const v3 = image();
    view(v3).setUint16(28, 3, true);
    view(v3).setUint16(30, 1, true);
    const old = await refused(v3, /^SquashFS version 3\.1 is not read; version 4\.0 is\.$/);
    expect(detail(old, "Compression")).toBe("gzip");
    const lzma = image();
    view(lzma).setUint16(20, 2, true);
    const legacy = await refused(lzma, /legacy LZMA format are not read/);
    expect(detail(legacy, "Compression")).toBe("LZMA");
    const unknown = image();
    view(unknown).setUint16(20, 9, true);
    await refused(unknown, /^SquashFS compression 9 is not known\.$/);
  });
});

describe("damage", () => {
  it("fails on what is not SquashFS, an impossible block size and a cut-short image", async () => {
    await expect(open(text(4096))).rejects.toThrow(
      "This is not a SquashFS image: its superblock is missing.",
    );
    const sized = image();
    view(sized).setUint32(12, 5000, true);
    await expect(open(sized)).rejects.toThrow(
      "The SquashFS image is damaged: its block size is not a power of two from 4 KiB to 1 MiB.",
    );
    const bytes = image();
    const used = view(bytes).getUint32(40, true);
    await expect(open(bytes.subarray(0, used - 100))).rejects.toThrow(
      /^The SquashFS image is cut short: it uses [\d.]+ KiB \([\d,]+ bytes\), but the file holds/,
    );
  });

  it("fails on a folder that holds itself", async () => {
    const tree: SqDir = {
      kind: "dir",
      name: "",
      children: [{ kind: "dir", name: "a", loop: true, children: [] }],
    };
    await expect(open(buildSquashfs(tree, { compressor: "lzo" }))).rejects.toThrow(
      "The SquashFS image is damaged: the folder “a/loop” holds itself.",
    );
  });

  it("fails on a damaged metadata block, and a damaged data block only when it is read", async () => {
    const bytes = image();
    const inodes = view(bytes).getUint32(64, true);
    bytes[inodes + 10] = (bytes[inodes + 10] ?? 0) ^ 0x55;
    await expect(open(bytes)).rejects.toThrow(
      /^The zlib stream is damaged|^The SquashFS image is damaged/,
    );
    const data = image({ compressor: "lz4" });
    const fs = await open(data);
    const big = entry(fs, "big.bin");
    data.fill(0xff, 96, view(data).getUint32(64, true));
    await expect(fs.read(big)).rejects.toThrow(
      /^The LZ4 stream is damaged|^The SquashFS image is damaged/,
    );
  });

  it("fails with a sentence, fast, wherever its tables are damaged", async () => {
    for (const compressor of ["gzip", "lzo", "zstd", "xz", "lz4"] as const) {
      const clean = image({ compressor, extended: compressor === "lzo" });
      const start = view(clean).getUint32(64, true);
      const used = view(clean).getUint32(40, true);
      const next = random(compressor.length * 7);
      for (let round = 0; round < 60; round++) {
        const bytes = clean.slice();
        const at =
          round % 3 === 0 ? Math.floor(next() * 96) : start + Math.floor(next() * (used - start));
        bytes[at] = (bytes[at] ?? 0) ^ (1 << Math.floor(next() * 8));
        const began = performance.now();
        try {
          const fs = await open(bytes);
          for (const e of fs.entries) if (e.kind === "file" && !e.refusal) await fs.read(e);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).constructor).toBe(Error);
          expect((error as Error).message).toMatch(/^[A-Z“].*[.]$/);
          expect((error as Error).message).not.toMatch(/undefined|NaN|\[object/);
        }
        expect(performance.now() - began).toBeLessThan(2000);
      }
    }
  }, 60000);
});

describe("cancels and pacing", () => {
  it("stops opening and reading when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      openSquashfs(memorySource(fixture("sample.snap")), { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    const fs = await open(image());
    await expect(
      fs.read(entry(fs, "big.bin"), Number.POSITIVE_INFINITY, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("gives the event loop a turn while it lists 20,000 files and reads a large one", async () => {
    const large = mixed(3 << 20, 30000, 8);
    const tree: SqDir = {
      kind: "dir",
      name: "",
      children: [
        { kind: "file", name: "large.bin", data: large },
        ...Array.from({ length: 40 }, (_, d) => ({
          kind: "dir" as const,
          name: `folder ${d}`,
          children: Array.from({ length: 500 }, (_, f) => ({
            kind: "file" as const,
            name: `file ${f}.txt`,
            data: text(20 + (f % 30), d * 500 + f),
          })),
        })),
      ],
    };
    const bytes = buildSquashfs(tree, { compressor: "zstd", blockSize: 131072 });
    const listed = await worstGap(() => open(bytes));
    expect(listed.result.entries.length).toBe(1 + 40 + 20000);
    expect(listed.worst).toBeLessThan(100);
    const fs = listed.result;
    const read = await worstGap(() => fs.read(entry(fs, "large.bin")));
    expect(sha256(read.result)).toBe(sha256(large));
    expect(read.worst).toBeLessThan(100);
  }, 60000);
});
