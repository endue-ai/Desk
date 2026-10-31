// RAR 4 archives made by RARLAB's rar 6.24 with -ma4 (make-fixtures.sh): every method level,
// stored, solid, PPMd (alone and mixed with LZ in one solid stream), the largest dictionary, and
// the E8, E8E9, delta, RGB and audio filters. Every entry's bytes and CRC match the originals.
import { describe, expect, it } from "vitest";
import { Filters4 } from "../../lib/rar/rar4/filters.js";
import { entry, expectOriginals, FEW, FOLDERS, LINK, openFixture, original, TREE } from "./helpers";

/** The kinds of the VM filters defined while `work` runs. */
async function filterKinds(work: () => Promise<void>) {
  const kinds = new Set<string>();
  const define = Filters4.prototype.define;
  Filters4.prototype.define = function (this: Filters4, ...args: Parameters<Filters4["define"]>) {
    define.apply(this, args);
    kinds.add(this.stack.at(-1)?.program.kind ?? "other");
  };
  try {
    await work();
  } finally {
    Filters4.prototype.define = define;
  }
  return [...kinds].sort();
}

describe("RAR 4", () => {
  for (const [level, method] of [
    [1, "Fastest"],
    [3, "Normal"],
    [5, "Best"],
  ] as const) {
    it(`decodes -m${level}: text, binary, empty and Unicode-named files`, async () => {
      const archive = await openFixture(`rar4-m${level}.rar`);
      expect(archive.format).toBe("RAR 4");
      await expectOriginals(archive, TREE);
      expect(entry(archive, "text.txt").method).toBe(method);
    });
  }

  it("lists names in RAR 3's Unicode form, folders, DOS dates and links", async () => {
    const archive = await openFixture("rar4-m3.rar");
    const paths = archive.entries.map((e) => e.path).sort();
    expect(paths).toEqual([...TREE, ...FOLDERS, LINK[0]].sort());
    for (const folder of FOLDERS) expect(entry(archive, folder).kind).toBe("folder");
    expect(entry(archive, LINK[0])).toMatchObject({ kind: "link", link: LINK[1], size: 0 });
    const date = entry(archive, "text.txt").date;
    expect([
      date?.getFullYear(),
      date?.getMonth(),
      date?.getDate(),
      date?.getHours(),
      date?.getMinutes(),
    ]).toEqual([2026, 9, 1, 12, 0]);
  });

  it("reads stored entries straight from the archive", async () => {
    await expectOriginals(await openFixture("rar4-stored.rar"), FEW);
  });

  it("decodes a solid LZ archive in order, out of order and in one pass", async () => {
    const paths = [
      "chapters/one.txt",
      "chapters/two.txt",
      "chapters/three.txt",
      "text.txt",
      "data.bin",
    ] as const;
    await expectOriginals(await openFixture("rar4-solid.rar"), [...paths].reverse());
    const archive = await openFixture("rar4-solid.rar");
    const seen: string[] = [];
    await archive.each(
      paths.map((p) => entry(archive, p)),
      async (e, bytes) => {
        seen.push(e.path);
        expect(bytes).toEqual(original(e.path as (typeof paths)[number]));
      },
    );
    expect(seen).toHaveLength(paths.length);
  });

  it("decodes PPMd (-mct+), its model carried across a solid archive's files", async () => {
    const archive = await openFixture("rar4-ppmd.rar");
    await expectOriginals(archive, [
      "chapters/one.txt",
      "text.txt",
      "chapters/three.txt",
      "chapters/two.txt",
    ]);
    expect(entry(archive, "chapters/two.txt").packed).toBeLessThan(8 * 1024);
  });

  it("decodes a solid stream that switches between LZ and PPMd", async () => {
    await expectOriginals(await openFixture("rar4-mixed.rar"), [
      "text.txt",
      "data.bin",
      "chapters/one.txt",
      "tool.exe",
    ]);
  });

  it("decodes matches as far back as RAR 4's largest dictionary", async () => {
    const archive = await openFixture("rar4-dict.rar");
    expect(entry(archive, "far4.bin").packed).toBeLessThan(80 * 1024);
    await expectOriginals(archive, ["far4.bin"]);
  });

  it("runs the standard E8, E8E9, delta, RGB and audio filters, recognised by their code", async () => {
    const kinds = await filterKinds(() =>
      openFixture("rar4-filters.rar").then((archive) =>
        expectOriginals(archive, [
          "image.bmp",
          "sound.wav",
          "table.dat",
          "tool.exe",
          "tool-e8.exe",
        ]),
      ),
    );
    expect(kinds).toEqual(["audio", "delta", "e8", "e8e9", "rgb"]);
  });
});
