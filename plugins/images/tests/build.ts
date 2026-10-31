// Files the tests build in code, for formats no tool on the machine writes: Netpbm P1 to P3, 16-bit
// TGA, ICNS it32, KTX 1, DICOM, FITS, NIfTI-1 and a PNG header. RAW containers: containers.ts.
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
