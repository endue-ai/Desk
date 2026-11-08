// Makes tests/fixtures/issue.cb7 with libarchive's bsdtar (the tar of macOS, libarchive-tools on
// Linux): the comic pages of comics.ts, named out of natural order, with a ComicInfo.xml and macOS
// junk, in one solid LZMA2 block under an encoded header. Run `node make-cb7.mjs`.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

const chunk = (type, data) => {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
};

/** A width x height PNG of one RGB colour, as tests/build/png.ts writes it. */
const png = (width, height, rgb) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rows.set(rgb, y * (1 + width * 3) + 1 + x * 3);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat([signature, ...parts]);
};

const PAGES = [
  ["Issue 1/10.png", png(6, 9, [200, 0, 0])],
  ["Issue 1/2.png", png(6, 9, [0, 200, 0])],
  ["Issue 1/ComicInfo.xml", "<ComicInfo><Title>Fixture</Title></ComicInfo>"],
  ["Issue 1/1.png", png(6, 9, [0, 0, 200])],
  ["__MACOSX/Issue 1/._1.png", "junk"],
];

const here = import.meta.dirname;
const out = join(here, "../fixtures/issue.cb7");
const work = mkdtempSync(join(tmpdir(), "reader-cb7-"));
try {
  const when = new Date("2026-10-01T12:00:00Z");
  for (const [name, data] of PAGES) {
    mkdirSync(join(work, dirname(name)), { recursive: true });
    writeFileSync(join(work, name), data);
  }
  // An mtree list gives each file its time and nothing else, so the archive comes out the same.
  const octal = (/** @type {string} */ s) =>
    s.replace(/[\\\s]/g, (c) => `\\${c.charCodeAt(0).toString(8).padStart(3, "0")}`);
  const list = PAGES.map(
    ([name]) =>
      `./${octal(name)} type=file mode=0644 time=${when.getTime() / 1000}.0 contents=${octal(join(work, name))}`,
  );
  writeFileSync(join(work, "list.mtree"), `#mtree\n${list.join("\n")}\n`);
  rmSync(out, { force: true });
  const options = ["--format", "7zip", "--options", "7zip:compression=lzma2"];
  execFileSync("bsdtar", [...options, "-cf", out, "@list.mtree"], { cwd: work });
  console.log(`wrote ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
