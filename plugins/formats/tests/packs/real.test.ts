// The images make-fixtures.sh builds with mksquashfs and wimlib-imagex in a container, against the
// tree it recorded in fixtures/real/expected.json. The suite runs once those fixtures are there
// (Docker builds them); until then the writer images of the other suites stand in for them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Archive } from "../../lib/disk/archive.js";
import { memorySource } from "../../lib/disk/source.js";
import { openAppImage, openSquashfs, openWim } from "../../lib/packs/index.js";
import { concat, elfStub } from "./elf-stub";
import { entry, sha256 } from "./squashfs-tree";

type Recorded = {
  path: string;
  kind: "file" | "folder" | "link";
  size?: number;
  sha256?: string;
  link?: string;
};
const dir = join(import.meta.dirname, "fixtures", "real");
const present = existsSync(join(dir, "expected.json"));
const expected = present
  ? (JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as {
      tree: Recorded[];
      other: Recorded[];
      devices: string[];
    })
  : { tree: [], other: [], devices: [] };
const image = (name: string) => new Uint8Array(readFileSync(join(dir, name)));

/** The archive holds the recorded tree under `prefix`, every file read to the byte. */
async function holds(archive: Archive, tree: Recorded[], prefix = "") {
  for (const want of tree) {
    const got = entry(archive, prefix + want.path);
    expect([got.path, got.kind]).toEqual([prefix + want.path, want.kind]);
    if (want.kind === "link") expect(got.link).toBe(want.link);
    if (want.kind === "file") {
      expect(got.size).toBe(want.size);
      expect(sha256(await archive.read(got))).toBe(want.sha256);
    }
  }
}
const devices = () => expected.devices.map((line) => line.split(" ")[0] ?? "");

describe.skipIf(!present)("images the real tools wrote (make-fixtures.sh)", () => {
  it.each(["gzip", "xz", "lz4", "zstd", "lzo"])("mksquashfs -comp %s", async (compression) => {
    const fs = await openSquashfs(memorySource(image(`tree-${compression}.sqfs`)));
    expect(fs.entries.length).toBe(expected.tree.length + 1 + expected.devices.length);
    await holds(fs, expected.tree);
    for (const path of devices()) expect(entry(fs, path).refusal).toMatch(/hold no data/);
  });

  it("mksquashfs -no-fragments -no-exports, and the same image as an AppImage", async () => {
    const bytes = image("tree-nofrag.sqfs");
    const fs = await openSquashfs(memorySource(bytes));
    expect(fs.entries.length).toBe(expected.tree.length);
    await holds(fs, expected.tree);
    const app = await openAppImage(memorySource(concat(elfStub(), bytes)));
    await holds(app, expected.tree);
  });

  it.each(["none", "xpress", "lzx"])(
    "wimlib-imagex --compress=%s, two images",
    async (compression) => {
      const wim = await openWim(memorySource(image(`tree-${compression}.wim`)));
      expect(wim.entries.length).toBe(2 + expected.tree.length + expected.other.length);
      await holds(wim, expected.tree, "1 Tree/");
      await holds(wim, expected.other, "2 Other/");
    },
  );

  it.each(["tree-lzms.wim", "tree.esd"])(
    "%s: listed and refused with LZMS's sentence",
    async (name) => {
      const wim = await openWim(memorySource(image(name)));
      expect(wim.entries[0]?.path).toBe("1 Other");
      const refused = wim.refusal ?? wim.entries.find((e) => e.refusal)?.refusal;
      expect(refused).toBe("LZMS compression is not read yet.");
    },
  );
});
