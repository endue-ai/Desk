// Comic archives and the formats the reader only describes: CBZ and CBT with pages named out of
// natural order, RAR 4 and RAR 5 headers (no data: only the listing is read), a 7z signature and
// a two-page bundled DjVu whose INFO chunks give each page's size.
import { concat, type Entry, tar, zip } from "./archive";
import { png } from "./png";

/** The pages in a shuffled, non-natural listing, a folder, a metadata file and macOS junk. */
export const COMIC_PAGES: Entry[] = [
  ["Issue 1/10.png", png(6, 9, [200, 0, 0])],
  ["Issue 1/2.png", png(6, 9, [0, 200, 0])],
  ["Issue 1/ComicInfo.xml", "<ComicInfo><Title>Fixture</Title></ComicInfo>"],
  ["Issue 1/1.png", png(6, 9, [0, 0, 200])],
  ["__MACOSX/Issue 1/._1.png", "junk"],
];

export const cbz = () => zip(COMIC_PAGES);
export const cbt = () => tar(COMIC_PAGES);

const text = (s: string) => new TextEncoder().encode(s);

/** A RAR 4 block; `data` bytes follow it (a file header's PACK_SIZE says how many). */
function rar4Block(type: number, flags: number, body: Uint8Array, data = 0): Uint8Array {
  const head = new DataView(new ArrayBuffer(7));
  head.setUint8(2, type);
  head.setUint16(3, flags | (data > 0 ? 0x8000 : 0), true);
  head.setUint16(5, 7 + body.length, true);
  return concat([new Uint8Array(head.buffer), body, new Uint8Array(data)]);
}

/** A RAR 4 archive listing these files (stored, with zero bytes for each body's place). */
export function rar4(names: string[]): Uint8Array {
  const files = names.map((name) => {
    const encoded = text(name);
    const body = new DataView(new ArrayBuffer(25));
    body.setUint32(0, 3, true);
    body.setUint32(4, 3, true);
    body.setUint8(18, 0x30);
    body.setUint16(19, encoded.length, true);
    return rar4Block(0x74, 0, concat([new Uint8Array(body.buffer), encoded]), 3);
  });
  return concat([
    new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]),
    rar4Block(0x73, 0, new Uint8Array(6)),
    ...files,
    rar4Block(0x7b, 0, new Uint8Array(0)),
  ]);
}

const vint = (value: number) => {
  const bytes: number[] = [];
  let v = value;
  do {
    bytes.push((v & 0x7f) | (v > 0x7f ? 0x80 : 0));
    v >>>= 7;
  } while (v > 0);
  return bytes;
};

function rar5Block(type: number, fields: number[], data = 0): Uint8Array {
  const flags = data > 0 ? 0x02 : 0;
  const rest = [...vint(type), ...vint(flags), ...(data > 0 ? vint(data) : []), ...fields];
  const head = [...vint(rest.length), ...rest];
  return concat([new Uint8Array(4), new Uint8Array(head), new Uint8Array(data)]);
}

/** A RAR 5 archive listing these files. */
export function rar5(names: string[]): Uint8Array {
  const files = names.map((name) => {
    const encoded = [...text(name)];
    return rar5Block(2, [0, ...vint(3), 0, 0, 0, ...vint(encoded.length), ...encoded], 3);
  });
  return concat([
    new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]),
    rar5Block(1, [0]),
    ...files,
    rar5Block(5, [0]),
  ]);
}

/** The 7z signature and a start header pointing at an (absent) encoded header. */
export function sevenZip(): Uint8Array {
  const out = new Uint8Array(64);
  out.set([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04], 0);
  return out;
}

function iff(id: string, body: Uint8Array): Uint8Array {
  const head = new DataView(new ArrayBuffer(8));
  new Uint8Array(head.buffer).set(text(id), 0);
  head.setUint32(4, body.length);
  return concat([new Uint8Array(head.buffer), body, new Uint8Array(body.length % 2)]);
}

function info(width: number, height: number, dpi: number): Uint8Array {
  const view = new DataView(new ArrayBuffer(10));
  view.setUint16(0, width);
  view.setUint16(2, height);
  view.setUint8(4, 24);
  view.setUint8(5, 0);
  view.setUint16(6, dpi, true);
  view.setUint8(8, 22);
  return new Uint8Array(view.buffer);
}

/** A bundled DjVu of two pages, 2550 x 3300 and 1700 x 2200 at 300 and 200 dpi. */
export function djvu(): Uint8Array {
  const page = (w: number, h: number, dpi: number) =>
    iff(
      "FORM",
      concat([text("DJVU"), iff("INFO", info(w, h, dpi)), iff("Sjbz", new Uint8Array(6))]),
    );
  const dirm = new Uint8Array([0x81, 0x00, 0x02, 0, 0, 0, 0, 0, 0, 0, 0]);
  const form = concat([
    text("DJVM"),
    iff("DIRM", dirm),
    page(2550, 3300, 300),
    page(1700, 2200, 200),
  ]);
  return concat([text("AT&T"), iff("FORM", form)]);
}

/** A single-page DjVu: FORM:DJVU at the top. */
export function djvuPage(): Uint8Array {
  return concat([
    text("AT&T"),
    iff("FORM", concat([text("DJVU"), iff("INFO", info(850, 1100, 100))])),
  ]);
}
