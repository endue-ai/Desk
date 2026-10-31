// MOBI fixtures: a MOBI 6 book (PalmDOC or HUFF/CDIC, filepos links, a recindex image, an NCX), the
// same with a DRM flag, and a KF8 (AZW3) book assembled from skeletons, fragments and a CSS flow.
import { concat } from "./archive";
import { cncx, huffcdic, indx, palmdoc, pdb } from "./palm";
import { png } from "./png";

const text = (s: string) => new TextEncoder().encode(s);
const NULL = 0xffffffff;
const RECORD = 4096;

interface Header {
  compression: number;
  textLength: number;
  textRecords: number;
  encryption?: number;
  version: 6 | 8;
  firstImage: number;
  title: string;
  extraFlags: number;
  huff?: [offset: number, count: number];
  ncx?: number;
  kf8?: { fdst: number; fdstCount: number; skel: number; frag: number };
}

function exth(records: Array<[number, string]>): Uint8Array {
  const bodies = records.map(([type, value]) => {
    const data = text(value);
    const head = new DataView(new ArrayBuffer(8));
    head.setUint32(0, type);
    head.setUint32(4, 8 + data.length);
    return concat([new Uint8Array(head.buffer), data]);
  });
  const size = 12 + bodies.reduce((n, b) => n + b.length, 0);
  const padded = size + ((4 - (size % 4)) % 4);
  const head = new DataView(new ArrayBuffer(12));
  head.setUint32(0, 0x45585448);
  head.setUint32(4, padded);
  head.setUint32(8, records.length);
  return concat([new Uint8Array(head.buffer), ...bodies, new Uint8Array(padded - size)]);
}

function record0(h: Header): Uint8Array {
  const length = h.version >= 8 ? 0x108 : 0xe8;
  const ext = exth([
    [100, "Fixture Author"],
    [503, h.title],
  ]);
  const title = text(h.title);
  const view = new DataView(new ArrayBuffer(16 + length));
  view.setUint16(0, h.compression);
  view.setUint32(4, h.textLength);
  view.setUint16(8, h.textRecords);
  view.setUint16(10, RECORD);
  view.setUint16(12, h.encryption ?? 0);
  view.setUint32(16, 0x4d4f4249);
  view.setUint32(20, length);
  view.setUint32(24, 2);
  view.setUint32(28, 65001);
  view.setUint32(32, 0x1234);
  view.setUint32(36, h.version);
  for (let at = 0x28; at < 0x50; at += 4) view.setUint32(at, NULL);
  view.setUint32(0x50, h.firstImage);
  view.setUint32(0x54, 16 + length + ext.length);
  view.setUint32(0x58, title.length);
  view.setUint32(0x5c, 9);
  view.setUint32(0x68, h.version);
  view.setUint32(0x6c, h.firstImage);
  view.setUint32(0x70, h.huff?.[0] ?? 0);
  view.setUint32(0x74, h.huff?.[1] ?? 0);
  view.setUint32(0x80, 0x40);
  view.setUint32(0xa4, NULL);
  view.setUint32(0xa8, NULL);
  if (h.kf8) {
    view.setUint32(0xc0, h.kf8.fdst);
    view.setUint32(0xc4, h.kf8.fdstCount);
  } else {
    view.setUint16(0xc0, 1);
    view.setUint16(0xc2, h.textRecords);
  }
  view.setUint32(0xc8, NULL);
  view.setUint32(0xd0, NULL);
  view.setUint32(0xe0, NULL);
  view.setUint16(0xf2, h.extraFlags);
  view.setUint32(0xf4, h.ncx ?? NULL);
  if (h.kf8) {
    view.setUint32(0xf8, h.kf8.frag);
    view.setUint32(0xfc, h.kf8.skel);
    view.setUint32(0x100, NULL);
    view.setUint32(0x104, NULL);
  }
  return concat([new Uint8Array(view.buffer), ext, title, new Uint8Array(4)]);
}

/** Text records of 4096 bytes, compressed, each with a multibyte byte and one trailing entry. */
function textRecords(raw: Uint8Array, compress: (chunk: Uint8Array) => Uint8Array): Uint8Array[] {
  const records: Uint8Array[] = [];
  for (let at = 0; at < raw.length; at += RECORD) {
    const body = compress(raw.subarray(at, at + RECORD));
    records.push(concat([body, new Uint8Array([0x00, 0xaa, 0xbb, 0x83])]));
  }
  return records;
}

const FILLER = Array.from(
  { length: 60 },
  (_, i) => `<p>Filler paragraph ${i} about the road and nothing else.</p>`,
).join("");

/** The MOBI 6 HTML, its filepos links pointing at the chapters' starts. */
function mobi6Html(): Uint8Array {
  const parts = [
    `<html><head><guide><reference type="toc" title="Contents" filepos=@toc@@@@@@ /></guide></head><body>`,
    `@@toc<h1>Contents</h1><p><a filepos=@one@@@@@@>Chapter One</a></p><p><a filepos=@two@@@@@@>Chapter Two</a></p><mbp:pagebreak/>`,
    `@@one<h1>Chapter One</h1><p>The lantern was lit at dusk.</p><p><img recindex="00001" alt="dot"/></p>${FILLER}<mbp:pagebreak/>`,
    `@@two<h1>Chapter Two</h1><p>The lantern swung on its hook.</p><script>steal()</script></body></html>`,
  ];
  let html = parts.join("");
  const positions: Record<string, number> = {};
  for (let m = /@@(\w+)/.exec(html); m; m = /@@(\w+)/.exec(html)) {
    positions[m[1] ?? ""] = m.index;
    html = html.slice(0, m.index) + html.slice(m.index + m[0].length);
  }
  // Each placeholder is ten characters, as the number that replaces it, so no position moves.
  html = html.replace(/@(\w+)@+/g, (_, name: string) => String(positions[name]).padStart(10, "0"));
  return text(html);
}

export interface MobiOptions {
  compression?: "palmdoc" | "huffcdic";
  encryption?: number;
}

export function mobi6(options: MobiOptions = {}): Uint8Array {
  const raw = mobi6Html();
  let compress = palmdoc;
  let huffRecords: Uint8Array[] = [];
  if (options.compression === "huffcdic") {
    // Every byte is its own phrase: the table is trivial, the decoder's path is not.
    const table = huffcdic(Array.from({ length: 256 }, (_, b) => new Uint8Array([b])));
    compress = (chunk) => table.encode([...chunk]);
    huffRecords = [table.huff, table.cdic];
  }
  const records = textRecords(raw, compress);
  const firstImage = 1 + records.length;
  const image = png(4, 4, [10, 140, 90]);
  const labels = cncx(["Contents", "Chapter One", "Chapter Two"]);
  const at = (needle: string) => new TextDecoder().decode(raw).indexOf(needle);
  const ncxIndex = firstImage + 1 + huffRecords.length;
  const ncx = indx(
    [
      { tag: 1, values: 1, mask: 0x01 },
      { tag: 3, values: 1, mask: 0x02 },
      { tag: 4, values: 1, mask: 0x04 },
    ],
    [
      { name: "0", tags: { 1: [at("<h1>Contents")], 3: [labels.offsets[0] ?? 0], 4: [0] } },
      { name: "1", tags: { 1: [at("<h1>Chapter One")], 3: [labels.offsets[1] ?? 0], 4: [0] } },
      { name: "2", tags: { 1: [at("<h1>Chapter Two")], 3: [labels.offsets[2] ?? 0], 4: [0] } },
    ],
    labels.record,
  );
  const header = record0({
    compression: options.compression === "huffcdic" ? 17480 : 2,
    textLength: raw.length,
    textRecords: records.length,
    encryption: options.encryption,
    version: 6,
    firstImage,
    title: "The Lantern Keeper",
    extraFlags: 0b11,
    huff: huffRecords.length ? [firstImage + 1, huffRecords.length] : undefined,
    ncx: ncxIndex,
  });
  return pdb("The_Lantern_Keeper", "BOOK", "MOBI", [
    header,
    ...records,
    image,
    ...huffRecords,
    ...ncx,
  ]);
}

const SKELETON = (i: number) =>
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Part ${i}</title><link href="kindle:flow:0001?mime=text/css" rel="stylesheet" type="text/css"/></head><body aid="${i}0"></body></html>`;

const FRAGMENTS = [
  `<div aid="01"><h1 id="one">Chapter One</h1><p>The lantern was lit at dusk.</p><p><a href="kindle:pos:fid:0001:off:0000000000">On to chapter two</a></p><p><img src="kindle:embed:0001?mime=image/png" alt="dot"/></p></div>`,
  `<div aid="11"><h1>Chapter Two</h1><p onclick="steal()">The lantern swung on its hook.</p></div>`,
];

/** A KF8 book (version 8, as an .azw3): two parts, a CSS flow, an image and an NCX. */
export function kf8(): Uint8Array {
  const css = "h1 { color: #336699; }";
  const skeletons = FRAGMENTS.map((_, i) => SKELETON(i));
  let raw = "";
  const skel: Array<{ name: string; tags: Record<number, number[]> }> = [];
  const frag: Array<{ name: string; tags: Record<number, number[]> }> = [];
  const selectors = cncx(FRAGMENTS.map((_, i) => `P-//*[@aid='${i}1']`));
  skeletons.forEach((skeleton, i) => {
    const start = raw.length;
    skel.push({
      name: `SKEL${String(i).padStart(10, "0")}`,
      tags: { 1: [1], 6: [start, skeleton.length] },
    });
    const insert = start + skeleton.indexOf("</body>");
    const fragment = FRAGMENTS[i] ?? "";
    frag.push({
      name: String(insert).padStart(10, "0"),
      tags: { 2: [selectors.offsets[i] ?? 0], 3: [i], 4: [i], 6: [0, fragment.length] },
    });
    raw += skeleton + fragment;
  });
  const flowStart = raw.length;
  raw += css;
  const records = textRecords(text(raw), palmdoc);
  const firstImage = 1 + records.length;
  const fdst = new DataView(new ArrayBuffer(12 + 16));
  fdst.setUint32(0, 0x46445354);
  fdst.setUint32(4, 12);
  fdst.setUint32(8, 2);
  fdst.setUint32(12, 0);
  fdst.setUint32(16, flowStart);
  fdst.setUint32(20, flowStart);
  fdst.setUint32(24, raw.length);
  const skelIndex = indx(
    [
      { tag: 1, values: 1, mask: 0x03 },
      { tag: 6, values: 2, mask: 0x0c },
    ],
    skel,
  );
  const fragIndex = indx(
    [
      { tag: 2, values: 1, mask: 0x01 },
      { tag: 3, values: 1, mask: 0x02 },
      { tag: 4, values: 1, mask: 0x04 },
      { tag: 6, values: 2, mask: 0x08 },
    ],
    frag,
    selectors.record,
  );
  const labels = cncx(["Chapter One", "Chapter Two"]);
  const ncxIndex = indx(
    [
      { tag: 3, values: 1, mask: 0x01 },
      { tag: 4, values: 1, mask: 0x02 },
      { tag: 6, values: 2, mask: 0x04 },
    ],
    [
      { name: "0", tags: { 3: [labels.offsets[0] ?? 0], 4: [0], 6: [0, 0] } },
      { name: "1", tags: { 3: [labels.offsets[1] ?? 0], 4: [0], 6: [1, 0] } },
    ],
    labels.record,
  );
  const fdstAt = firstImage + 1;
  const skelAt = fdstAt + 1;
  const fragAt = skelAt + skelIndex.length;
  const ncxAt = fragAt + fragIndex.length;
  const header = record0({
    compression: 2,
    textLength: raw.length,
    textRecords: records.length,
    version: 8,
    firstImage,
    title: "The Lantern Keeper (KF8)",
    extraFlags: 0b11,
    ncx: ncxAt,
    kf8: { fdst: fdstAt, fdstCount: 2, skel: skelAt, frag: fragAt },
  });
  const image = png(4, 4, [10, 140, 90]);
  return pdb("Lantern_KF8", "BOOK", "MOBI", [
    header,
    ...records,
    image,
    new Uint8Array(fdst.buffer),
    ...skelIndex,
    ...fragIndex,
    ...ncxIndex,
  ]);
}
