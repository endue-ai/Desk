// Builds the DjVu fixtures: writes the generated sources (images.mjs) to a temporary folder,
// encodes them with DjVuLibre's tools in a Linux container (encode.sh), then wraps the photo's
// IW44 data as the stand-alone IW44 forms (FORM:PM44, FORM:BM44).
// Run: node make-fixtures.mjs [output folder, the fixtures folder by default]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as I from "./images.mjs";

const { PAGES, TEXT, OUTLINE } = I;

const here = import.meta.dirname;
const out = process.argv[2] ?? join(here, "..", "fixtures");
const work = mkdtempSync(join(tmpdir(), "djvu-fixtures-"));
mkdirSync(out, { recursive: true });

const put = (/** @type {string} */ name, /** @type {Uint8Array | string} */ data) =>
  writeFileSync(join(work, name), data);

put("text.txt", I.sampleText(30000));
put("bytes.bin", I.sampleBytes(24000));
put("page.pbm", I.pbm(I.textPage(PAGES.bitonal)));
put("big.pbm", I.pbm(I.textPage(PAGES.big)));
put("shared1.pbm", I.pbm(I.textPage(PAGES.shared1)));
put("shared2.pbm", I.pbm(I.textPage(PAGES.shared2)));
put("photo.ppm", I.ppm(I.photo(320, 240)));
put("photo.pgm", I.pgm(I.grey(I.photo(320, 240))));
const mask = I.textPage(PAGES.mask);
put("mask.pbm", I.pbm(mask));
put("compound.ppm", I.ppm(I.compound(mask)));
put("colours.ppm", I.ppm(I.colours(I.textPage(PAGES.colours))));
put("page1.txt", TEXT[0]);
put("page2.txt", TEXT[1]);
put("outline.txt", OUTLINE);
put("meta.txt", 'title "A test book"\n');
put(
  "book.djvused",
  [
    "select 1",
    "set-txt page1.txt",
    "select 2",
    "set-txt page2.txt",
    "select 3",
    "set-rotation 1",
    "select",
    "set-outline outline.txt",
    "set-meta meta.txt",
    "",
  ].join("\n"),
);
writeFileSync(join(work, "encode.sh"), readFileSync(join(here, "encode.sh")));

execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    `${work}:/work`,
    "-v",
    `${out}:/out`,
    "debian:bookworm-slim",
    "bash",
    "/work/encode.sh",
  ],
  { stdio: "inherit" },
);

// FORM:PM44 and FORM:BM44: the photo's BG44 chunks as PM44 or BM44 chunks.
for (const [from, to, id] of [
  ["photo.djvu", "photo.iw4", "PM44"],
  ["photo-grey.djvu", "photo-grey.iw4", "BM44"],
]) {
  writeFileSync(join(out, to), iw44Form(readFileSync(join(out, from)), id));
}
// The SHA-256 of the pixels (after the PBM header) of ddjvu's masks of the shared-dictionary pages.
const pixels = (/** @type {Buffer} */ pbm) => {
  const head = /^P4\s+\d+\s+\d+\s/.exec(pbm.subarray(0, 32).toString("latin1"));
  if (!head) throw new Error("ddjvu wrote no PBM");
  return createHash("sha256").update(pbm.subarray(head[0].length)).digest("hex");
};
const shared = [1, 2].map((n) => pixels(readFileSync(join(work, `shared-${n}.pbm`))));
writeFileSync(join(out, "expected.json"), `${JSON.stringify({ sharedMasks: shared }, null, 2)}\n`);
rmSync(work, { recursive: true, force: true });

/** @param {Uint8Array} djvu @param {string} id */
function iw44Form(djvu, id) {
  const view = new DataView(djvu.buffer, djvu.byteOffset, djvu.byteLength);
  /** @type {Uint8Array[]} */
  const chunks = [];
  for (let at = 16; at + 8 <= djvu.length; ) {
    const name = new TextDecoder().decode(djvu.subarray(at, at + 4));
    const size = view.getUint32(at + 4);
    if (name === "BG44") chunks.push(djvu.subarray(at + 8, at + 8 + size));
    at += 8 + size + (size & 1);
  }
  const body = chunks.reduce((n, c) => n + 8 + c.length + (c.length & 1), 4);
  const form = new Uint8Array(12 + body);
  const w = new DataView(form.buffer);
  form.set(new TextEncoder().encode(`AT&TFORM`), 0);
  w.setUint32(8, body);
  form.set(new TextEncoder().encode(id), 12);
  let at = 16;
  for (const c of chunks) {
    form.set(new TextEncoder().encode(id), at);
    w.setUint32(at + 4, c.length);
    form.set(c, at + 8);
    at += 8 + c.length + (c.length & 1);
  }
  return form;
}
