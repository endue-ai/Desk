// SquashFS: images mksquashfs wrote (xz as a Snap, gzip) and images from the test writer with every
// compressor (gzip, xz, LZ4, zstd, LZO), basic and extended inodes, with and without fragments,
// listed and read to the byte; AppImages around them; refusals, damage, cancels and pacing.
import { describe, expect, it } from "vitest";
import { memorySource } from "../../lib/disk/source.js";
import { openAppImage, openSquashfs } from "../../lib/packs/index.js";
import { concat, elfStub } from "./elf-stub";
import type { Compressor } from "./pack-encoders";
import { mixed, noise, text } from "./samples";
import { buildSquashfs, type SqDir, type SqOptions } from "./squashfs-builder";
import { counted, detail, entry, expectTree, fixture, sampleTree, sha256 } from "./squashfs-tree";

const README = "# Sample\n\nA small tree for the archives plugin's tests.\n";
const open = (bytes: Uint8Array, options = {}) => openSquashfs(memorySource(bytes), options);
const COMPRESSORS: Compressor[] = ["gzip", "xz", "lz4", "zstd", "lzo"];

describe("images mksquashfs wrote", () => {
  it.each([
    ["sample.snap", "xz"],
    ["sample.squashfs", "gzip"],
  ])("%s (%s): lists and reads its files from a fragment", async (name, compression) => {
    const fs = await open(fixture(name), { format: "Snap" });
    expect(fs.format).toBe("Snap");
    expect(detail(fs, "Compression")).toBe(compression);
    expect(detail(fs, "Inodes")).toBe("3");
    expect(detail(fs, "Created")).toBe("2026-10-01 12:00:00");
    expect(detail(fs, "Fragments")).toBe("1");
    expect(fs.entries.map((e) => [e.path, e.kind, e.size])).toEqual([
      ["readme.md", "file", 56],
      ["한글.txt", "file", 16],
    ]);
    expect(entry(fs, "readme.md").date?.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(new TextDecoder().decode(await fs.read(entry(fs, "readme.md")))).toBe(README);
    expect(new TextDecoder().decode(await fs.read(entry(fs, "한글.txt")))).toBe("안녕하세요\n");
    expect(new TextDecoder().decode(await fs.read(entry(fs, "readme.md"), 8))).toBe("# Sample");
  });
});

describe.each(COMPRESSORS)("images in %s", (compressor) => {
  it.each<[string, Partial<SqOptions>]>([
    ["basic inodes", {}],
    ["extended inodes and compressor options", { extended: true, options: true }],
    ["no fragments and no export table", { fragments: false, exportTable: false }],
  ])("%s: lists and reads every file to the byte", async (_, options) => {
    const tree = sampleTree();
    const bytes = buildSquashfs(tree, { compressor, ...options });
    const fs = await open(bytes);
    expect(fs.format).toBe("SquashFS");
    await expectTree(fs, tree);
    expect(entry(fs, "big.bin").method).toBe(
      { gzip: "gzip", xz: "xz", lz4: "LZ4", zstd: "zstd", lzo: "LZO" }[compressor],
    );
    expect(entry(fs, "docs/readme.md").date?.getTime()).toBe(1790000000 * 1000);
    expect(entry(fs, "deep/a/b/c/d/e/f/deep.txt").size).toBe(5000);
    expect(fs.entries.findIndex((e) => e.path === "deep/a")).toBeLessThan(
      fs.entries.findIndex((e) => e.path === "deep/a/b"),
    );
    const big = entry(fs, "big.bin");
    const first = await fs.read(big, 10);
    expect(first.length).toBe(10);
    expect(sha256(await fs.read(big, 4096 * 3 + 7))).toBe(
      sha256((await fs.read(big)).subarray(0, 4096 * 3 + 7)),
    );
    if (options.options) expect(detail(fs, "Compression options")).toBeTruthy();
  });
});

describe("writer images", () => {
  it("reads sparse blocks as zeros and a folder of 3,000 files across metadata blocks", async () => {
    const sparse = new Uint8Array(4096 * 5);
    sparse.set(text(100), 4096 * 2);
    const many = Array.from({ length: 3000 }, (_, i) => ({
      kind: "file" as const,
      name: `file-${String(i).padStart(4, "0")}-with-a-long-name.txt`,
      data: text(10 + (i % 50), i),
    }));
    const tree: SqDir = {
      kind: "dir",
      name: "",
      children: [
        { kind: "file", name: "sparse.img", data: sparse },
        { kind: "dir", name: "many", children: many },
      ],
    };
    const fs = await open(buildSquashfs(tree, { compressor: "zstd", sparse: true }));
    await expectTree(fs, tree);
    expect(fs.entries.length).toBe(3002);
  });

  it("opens without reading file data, and a read takes only the blocks it needs", async () => {
    const big = noise(1 << 20, 11);
    const tree: SqDir = {
      kind: "dir",
      name: "",
      children: [{ kind: "file", name: "large.bin", data: big }, ...sampleTree().children],
    };
    const bytes = buildSquashfs(tree, { compressor: "lz4" });
    const { source, count } = counted(bytes);
    const fs = await openSquashfs(source);
    expect(count.bytes).toBeLessThan(160 * 1024);
    count.bytes = 0;
    expect(await fs.read(entry(fs, "large.bin"), 10)).toEqual(big.subarray(0, 10));
    expect(count.bytes).toBeLessThanOrEqual(4096 + 64);
  });
});

describe("AppImages", () => {
  const app = (): SqDir => ({
    kind: "dir",
    name: "",
    children: [
      {
        kind: "file",
        name: "sample.desktop",
        data: new TextEncoder().encode(
          "[Desktop Entry]\nType=Application\nName=Sample App\nComment=A sample\nX-AppImage-Version=1.2.3\n[Desktop Action New]\nName=Other\n",
        ),
      },
      { kind: "file", name: "AppRun", data: text(3000, 2), mode: 0o755 },
      { kind: "symlink", name: ".DirIcon", target: "sample.png" },
      { kind: "file", name: "sample.png", data: noise(700, 3) },
      {
        kind: "dir",
        name: "usr",
        children: [
          {
            kind: "dir",
            name: "bin",
            children: [{ kind: "file", name: "sample", data: mixed(9000) }],
          },
        ],
      },
    ],
  });

  it("reads a type 2 AppImage: the runtime's facts, the desktop entry and the files", async () => {
    const tree = app();
    const elf = elfStub({
      update: "gh-releases-zsync|example|sample|latest|Sample-*x86_64.AppImage.zsync",
    });
    const image = await openAppImage(
      memorySource(concat(elf, buildSquashfs(tree, { compressor: "zstd" }))),
    );
    expect(image.format).toBe("AppImage");
    expect(detail(image, "AppImage type")).toBe("2");
    expect(detail(image, "Architecture")).toBe("x86-64");
    expect(detail(image, "Runtime")).toMatch(/^ELF 64-bit little-endian, \d/);
    expect(detail(image, "Update information")).toMatch(/^gh-releases-zsync\|example/);
    expect(detail(image, "Signed")).toBe("No");
    expect(detail(image, "Name")).toBe("Sample App");
    expect(detail(image, "Version")).toBe("1.2.3");
    expect(detail(image, "Compression")).toBe("zstd");
    await expectTree(image, tree);
  });

  it.each([
    ["32-bit ARM", { wide: false, machine: 40, signed: true }, "ARM", "Yes"],
    ["64-bit ARM", { machine: 183 }, "ARM64", "No"],
    ["big-endian PowerPC", { big: true, machine: 21 }, "PowerPC 64-bit", "No"],
  ] as const)("reads the runtime of a %s AppImage", async (_, stub, arch, signed) => {
    const tree = app();
    const image = await openAppImage(
      memorySource(concat(elfStub(stub), buildSquashfs(tree, { compressor: "gzip" }))),
    );
    expect(detail(image, "Architecture")).toBe(arch);
    expect(detail(image, "Signed")).toBe(signed);
    await expectTree(image, tree);
  });

  it("finds the file system past padding after the ELF, and reads mksquashfs's image there", async () => {
    const bytes = concat(elfStub(), new Uint8Array(3000), fixture("sample.squashfs"));
    const image = await openAppImage(memorySource(bytes));
    expect(detail(image, "File system at")).toMatch(/^byte /);
    expect(new TextDecoder().decode(await image.read(entry(image, "readme.md")))).toBe(README);
  });

  it("refuses type 1 AppImages, and fails without an ELF or a file system", async () => {
    const iso = concat(elfStub({ type: 1 }), new Uint8Array(40000));
    iso.set(new TextEncoder().encode("\x01CD001"), 0x8000);
    const refused = await openAppImage(memorySource(iso));
    expect(refused.refusal).toMatch(/^Type 1 AppImages are ISO 9660 images/);
    expect(refused.entries).toEqual([]);
    await expect(openAppImage(memorySource(text(4096)))).rejects.toThrow(
      "This is not an AppImage: it does not start with an ELF runtime.",
    );
    await expect(
      openAppImage(memorySource(concat(elfStub(), new Uint8Array(500)))),
    ).rejects.toThrow("The AppImage holds no SquashFS file system after its runtime.");
  });
});
