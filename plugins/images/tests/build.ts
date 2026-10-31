// Files the tests build in code, for formats no tool on the machine writes: Netpbm P1 to P3, 16-bit
// TGA, ICNS it32, KTX 1, DICOM, FITS, NIfTI-1, a PNG header, TIFF-based RAW, CR3 and RAF containers.
import { crc32 } from "node:zlib";

/** The pattern make-fixtures.py draws: a flat block on the left, a gradient on the right. */
export const pattern = (x: number, y: number): [number, number, number, number] =>
  x < 4
    ? [10, 20, 30, 255]
    : [(x * 60) % 256, (y * 80) % 256, (x * 30 + y * 40) % 256, (x + y) % 3 ? 255 : 128];

/** RGBA bytes, top row first, from a pixel function. */
export function rgba(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly number[],
) {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) out.set(pixel(x, y), (y * width + x) * 4);
  return out;
}

export const ascii = (text: string) => new TextEncoder().encode(text);

export function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Little- or big-endian writer. */
class Writer {
  bytes: number[] = [];
  constructor(readonly le = true) {}
  u8(...values: number[]) {
    this.bytes.push(...values.map((v) => v & 0xff));
    return this;
  }
  u16(v: number) {
    return this.le ? this.u8(v, v >> 8) : this.u8(v >> 8, v);
  }
  u32(v: number) {
    return this.le ? this.u8(v, v >> 8, v >> 16, v >>> 24) : this.u8(v >>> 24, v >> 16, v >> 8, v);
  }
  f32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, this.le);
    return this.u8(...b);
  }
  text(s: string) {
    return this.u8(...ascii(s));
  }
  raw(b: Uint8Array) {
    for (const v of b) this.bytes.push(v);
    return this;
  }
  get length() {
    return this.bytes.length;
  }
  done() {
    return new Uint8Array(this.bytes);
  }
}
export const writer = (le = true) => new Writer(le);

/** A plain Netpbm file: P1 (bits), P2 (grey) or P3 (RGB), with a comment in the header. */
export function plainPnm(
  kind: 1 | 2 | 3,
  width: number,
  height: number,
  values: number[],
  max = 255,
) {
  const head =
    kind === 1
      ? `P1\n# fixture\n${width} ${height}\n`
      : `P${kind}\n# fixture\n${width} ${height}\n${max}\n`;
  return ascii(`${head}${values.join(" ")}\n`);
}

/** A 16-bit (A1R5G5B5) uncompressed TGA, top row first. */
export function tga16(width: number, height: number, pixel: (x: number, y: number) => number) {
  const w = writer().u8(0, 0, 2).u16(0).u16(0).u8(0).u16(0).u16(0).u16(width).u16(height);
  w.u8(16, 0x20 | 1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) w.u16(pixel(x, y));
  return w.done();
}

/** ICNS packbits for one channel: runs of three or more repeat, the rest are literals. */
function icnsRle(channel: number[]) {
  const out: number[] = [];
  let i = 0;
  while (i < channel.length) {
    let run = 1;
    while (i + run < channel.length && channel[i + run] === channel[i] && run < 130) run++;
    if (run >= 3) {
      out.push(0x80 + run - 3, channel[i] ?? 0);
      i += run;
      continue;
    }
    const start = i;
    while (i < channel.length && i - start < 128) {
      const v = channel[i];
      if (channel[i + 1] === v && channel[i + 2] === v) break;
      i++;
    }
    out.push(i - start - 1, ...channel.slice(start, i));
  }
  return out;
}

/** An ICNS with one RLE entry (it32 128, ih32 48, il32 32, is32 16) and its 8-bit mask. */
export function icnsRleEntry(
  type: "it32" | "ih32" | "il32" | "is32",
  size: number,
  pixel: (x: number, y: number) => readonly number[],
) {
  const masks = { it32: "t8mk", ih32: "h8mk", il32: "l8mk", is32: "s8mk" } as const;
  const px = rgba(size, size, pixel);
  const channel = (c: number) => Array.from({ length: size * size }, (_, i) => px[i * 4 + c] ?? 0);
  const body = [
    ...(type === "it32" ? [0, 0, 0, 0] : []),
    ...[0, 1, 2].flatMap((c) => icnsRle(channel(c))),
  ];
  const mask = channel(3);
  const entry = (name: string, data: number[]) =>
    writer(false)
      .text(name)
      .u32(data.length + 8)
      .u8(...data)
      .done();
  const entries = concat(entry(type, body), entry(masks[type], mask));
  return concat(
    writer(false)
      .text("icns")
      .u32(entries.length + 8)
      .done(),
    entries,
  );
}

/** A KTX 1 file holding one uncompressed RGBA8 image, rows padded to four bytes. */
export function ktx1(width: number, height: number, pixels: Uint8Array) {
  const w = writer().u8(0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a);
  w.u32(0x04030201).u32(0x1401).u32(1).u32(0x1908).u32(0x8058).u32(0x1908);
  w.u32(width).u32(height).u32(0).u32(0).u32(1).u32(1).u32(0);
  w.u32(width * height * 4).raw(pixels);
  return w.done();
}

/** One explicit-VR little-endian DICOM element. */
function element(w: Writer, group: number, tag: number, vr: string, value: Uint8Array) {
  w.u16(group).u16(tag).text(vr);
  if (["OB", "OW", "OF", "SQ", "UT", "UN"].includes(vr)) w.u16(0).u32(value.length);
  else w.u16(value.length);
  w.raw(value);
}
const even = (s: string) => ascii(s.length % 2 ? `${s} ` : s);
const uid = (s: string) => {
  const b = ascii(s);
  return b.length % 2 ? concat(b, new Uint8Array(1)) : b;
};
const us = (v: number) => writer().u16(v).done();

/** A DICOM file: 16-bit signed monochrome with a rescale and a window, explicit VR little endian. */
export function dicom16(
  width: number,
  height: number,
  stored: number[],
  { center = 40, width: ww = 400, intercept = -1024, slope = 1 } = {},
) {
  const meta = writer();
  element(meta, 2, 0x0001, "OB", new Uint8Array([0, 1]));
  element(meta, 2, 0x0002, "UI", uid("1.2.840.10008.5.1.4.1.1.2"));
  element(meta, 2, 0x0003, "UI", uid("1.2.3.4"));
  element(meta, 2, 0x0010, "UI", uid("1.2.840.10008.1.2.1"));
  const w = writer().raw(new Uint8Array(128)).text("DICM");
  element(w, 2, 0x0000, "UL", writer().u32(meta.length).done());
  w.raw(meta.done());
  element(w, 8, 0x0060, "CS", even("CT"));
  element(w, 0x28, 0x0002, "US", us(1));
  element(w, 0x28, 0x0004, "CS", even("MONOCHROME2"));
  element(w, 0x28, 0x0010, "US", us(height));
  element(w, 0x28, 0x0011, "US", us(width));
  element(w, 0x28, 0x0100, "US", us(16));
  element(w, 0x28, 0x0101, "US", us(12));
  element(w, 0x28, 0x0102, "US", us(11));
  element(w, 0x28, 0x0103, "US", us(1));
  element(w, 0x28, 0x1050, "DS", even(String(center)));
  element(w, 0x28, 0x1051, "DS", even(String(ww)));
  element(w, 0x28, 0x1052, "DS", even(String(intercept)));
  element(w, 0x28, 0x1053, "DS", even(String(slope)));
  const px = writer();
  for (const v of stored) px.u16(v & 0xffff);
  element(w, 0x7fe0, 0x0010, "OW", px.done());
  return w.done();
}

/** A FITS file whose primary HDU is a 2-D image; data rows bottom row first, as FITS stores them. */
export function fits(width: number, height: number, values: number[], bitpix: -32 | 16 = -32) {
  const card = (s: string) => s.padEnd(80, " ");
  const cards = [
    card("SIMPLE  =                    T"),
    card(`BITPIX  = ${String(bitpix).padStart(20)}`),
    card("NAXIS   =                    2"),
    card(`NAXIS1  = ${String(width).padStart(20)}`),
    card(`NAXIS2  = ${String(height).padStart(20)}`),
    card("COMMENT a test pattern"),
    card("END"),
  ].join("");
  const header = ascii(cards.padEnd(Math.ceil(cards.length / 2880) * 2880, " "));
  const w = writer(false);
  for (const v of values) bitpix === -32 ? w.f32(v) : w.u16(v);
  const data = w.done();
  const padded = new Uint8Array(Math.ceil(data.length / 2880) * 2880);
  padded.set(data);
  return concat(header, padded);
}

/** A single-file NIfTI-1 volume (n+1) of 16-bit signed voxels, x fastest. */
export function nifti(
  nx: number,
  ny: number,
  nz: number,
  voxel: (x: number, y: number, z: number) => number,
) {
  const w = writer().u32(348);
  while (w.length < 40) w.u8(0);
  for (const d of [3, nx, ny, nz, 1, 1, 1, 1]) w.u16(d);
  while (w.length < 70) w.u8(0);
  w.u16(4).u16(16);
  while (w.length < 76) w.u8(0);
  for (const p of [1, 1, 1, 1, 0, 0, 0, 0]) w.f32(p);
  w.f32(352).f32(0).f32(0);
  while (w.length < 344) w.u8(0);
  w.text("n+1").u8(0).u32(0);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) w.u16(voxel(x, y, z));
  return w.done();
}

/** A PNG's signature and IHDR, and an empty IEND: enough for the size, never for the pixels. */
export function pngHeader(width: number, height: number) {
  const chunk = (type: string, data: Uint8Array) => {
    const body = concat(ascii(type), data);
    return concat(
      writer(false).u32(data.length).done(),
      body,
      writer(false).u32(crc32(body)).done(),
    );
  };
  const ihdr = writer(false).u32(width).u32(height).u8(8, 6, 0, 0, 0).done();
  return concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IEND", new Uint8Array()),
  );
}

type Value = number[] | string | Uint8Array | { blob: string };
type Entry = [tag: number, type: 2 | 3 | 4 | 5 | 7, values: Value];
type Ifd = Entry[];
const POINTERS = new Set([0x14a, 0x8769, 0x8825]);

/**
 * A little-endian TIFF: IFD0 (chained to IFD1 when given) and more IFDs that the pointer tags (0x14a
 * SubIFDs, 0x8769 EXIF, 0x8825 GPS) name by index into `subIfds`. RATIONAL values are written as
 * numerator, denominator pairs. `{ blob }` values point at a blob written after the IFDs: its
 * offset, or its length for the byte-count tags 0x202 and 0x117.
 */
export function tiff(
  ifd0: Ifd,
  {
    ifd1,
    subIfds = [],
    blobs = {},
  }: { ifd1?: Ifd; subIfds?: Ifd[]; blobs?: Record<string, Uint8Array> } = {},
) {
  const all = [ifd0, ...(ifd1 ? [ifd1] : []), ...subIfds];
  const firstSub = ifd1 ? 2 : 1;
  const bytesOf = (type: number, v: Value): Uint8Array | null => {
    if (typeof v === "string") return concat(ascii(v), new Uint8Array(1));
    if (v instanceof Uint8Array) return v;
    if (!Array.isArray(v)) return null;
    const vw = writer();
    for (const n of v) type === 3 ? vw.u16(n) : vw.u32(n);
    return vw.done();
  };
  const size = (ifd: Ifd) =>
    2 +
    ifd.length * 12 +
    4 +
    ifd.reduce((n, [, type, v]) => {
      const b = bytesOf(type, v);
      return n + (b && b.length > 4 ? b.length + (b.length % 2) : 0);
    }, 0);
  let at = 8;
  const offsets = all.map((ifd) => {
    const o = at;
    at += size(ifd);
    return o;
  });
  const blobAt: Record<string, number> = {};
  for (const [name, blob] of Object.entries(blobs)) {
    blobAt[name] = at;
    at += blob.length + (blob.length % 2);
  }
  const w = writer().text("II").u16(42).u32(8);
  all.forEach((ifd, i) => {
    const entries = [...ifd].sort((a, b) => a[0] - b[0]);
    let data = (offsets[i] ?? 0) + 2 + entries.length * 12 + 4;
    const tail = writer();
    w.u16(entries.length);
    for (const [tag, type, v] of entries) {
      let values: Value = v;
      if (!Array.isArray(v) && typeof v === "object" && !(v instanceof Uint8Array)) {
        const blob = blobs[v.blob] ?? new Uint8Array();
        values = [tag === 0x202 || tag === 0x117 ? blob.length : (blobAt[v.blob] ?? 0)];
      } else if (POINTERS.has(tag) && Array.isArray(v)) {
        values = v.map((n) => offsets[firstSub + n] ?? 0);
      }
      const raw = bytesOf(type, values) ?? new Uint8Array();
      const count = Array.isArray(values) ? values.length / (type === 5 ? 2 : 1) : raw.length;
      w.u16(tag).u16(type).u32(count);
      if (raw.length <= 4) w.raw(concat(raw, new Uint8Array(4 - raw.length)));
      else {
        w.u32(data);
        tail.raw(raw);
        if (raw.length % 2) tail.u8(0);
        data += raw.length + (raw.length % 2);
      }
    }
    w.u32(i === 0 && ifd1 ? (offsets[1] ?? 0) : 0);
    w.raw(tail.done());
  });
  for (const blob of Object.values(blobs)) {
    w.raw(blob);
    if (blob.length % 2) w.u8(0);
  }
  return w.done();
}

/** An ISO BMFF box: size, type, then the payload. */
export const box = (type: string, ...payload: Uint8Array[]) => {
  const body = concat(...payload);
  return concat(
    writer(false)
      .u32(body.length + 8)
      .text(type)
      .done(),
    body,
  );
};
const uuidBytes = (hex: string) =>
  new Uint8Array(hex.match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? []);
export const uuidBox = (hex: string, ...payload: Uint8Array[]) =>
  box("uuid", uuidBytes(hex), ...payload);

/** A CR3: ftyp crx, moov with Canon's uuid (CMT1 and a THMB), the preview uuid with PRVW, an mdat. */
export function cr3(
  cmt1: Uint8Array,
  thumbnail: Uint8Array,
  preview: Uint8Array,
  mdat: Uint8Array,
) {
  const thmb = box(
    "THMB",
    writer(false).u8(0, 0, 0, 0).u16(16).u16(12).u32(thumbnail.length).u16(0).u16(0).done(),
    thumbnail,
  );
  const canon = uuidBox("85c0b687820f11e08111f4ce462b6a48", box("CMT1", cmt1), thmb);
  const prvw = box(
    "PRVW",
    writer(false).u32(0).u16(1).u16(64).u16(48).u16(1).u32(preview.length).done(),
    preview,
  );
  const previewUuid = uuidBox(
    "eaf42b5e1c984b88b9fbb7dc406e4d16",
    writer(false).u32(0).u32(1).done(),
    prvw,
  );
  const ftyp = box("ftyp", ascii("crx "), writer(false).u32(1).done(), ascii("crx isom"));
  return concat(ftyp, box("moov", canon), previewUuid, box("mdat", mdat));
}

/** A RAF: Fujifilm's header, the JPEG it points to (at 84 and 88, big-endian), then CFA bytes. */
export function raf(jpeg: Uint8Array, cfa: Uint8Array) {
  const w = writer(false).text("FUJIFILMCCD-RAW 0201FF383501");
  w.text("Example X-1".padEnd(32, "\0"));
  while (w.length < 84) w.u8(0);
  const jpegAt = 160;
  w.u32(jpegAt)
    .u32(jpeg.length)
    .u32(0)
    .u32(0)
    .u32(jpegAt + jpeg.length)
    .u32(cfa.length);
  while (w.length < jpegAt) w.u8(0);
  return w.raw(jpeg).raw(cfa).done();
}

/** A JPEG with an APP1 segment (an EXIF block, say) inserted right after its SOI. */
export function withApp1(jpeg: Uint8Array, payload: Uint8Array) {
  const head = writer(false)
    .u8(0xff, 0xe1)
    .u16(payload.length + 2)
    .done();
  return concat(jpeg.subarray(0, 2), head, payload, jpeg.subarray(2));
}
