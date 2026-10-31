// Camera RAW containers the tests build around real JPEGs: TIFF with SubIFDs and EXIF and GPS
// IFDs, Canon's CR3 (ISO BMFF boxes) and Fujifilm's RAF.
import { ascii, concat, writer } from "./build";

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
