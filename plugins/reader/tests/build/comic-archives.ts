// CB7 and CBR comics for the reader's tests. CB7: fixtures/issue.cb7, which make-cb7.mjs has
// libarchive's bsdtar write (one solid LZMA2 block, an encoded header). CBR: a stored RAR 5 written
// here with the PNG pages of comics.ts, and endue.formats' own fixtures (RAR made by RARLAB's rar
// through plugins/formats/tests/rar/make-fixtures.sh, 7z by 7-Zip) with file names turned into page
// names of the same length and the header CRCs made again.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { bytesOf, concat, type Entry } from "./archive";

const formats = join(import.meta.dirname, "../../../formats/tests");

/** One of endue.formats' fixtures: `rar/rar5-solid.rar`, `sevenzip/copy.7z`, `djvu/book.djvu`. */
export const library = (path: string) =>
  new Uint8Array(readFileSync(join(formats, path.replace("/", "/fixtures/"))));

/** The CB7 make-cb7.mjs wrote. */
export const cb7 = () =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "../fixtures/issue.cb7")));

const vint = (value: number) => {
  const out: number[] = [];
  let v = value;
  do {
    out.push((v & 0x7f) | (v > 0x7f ? 0x80 : 0));
    v = Math.floor(v / 128);
  } while (v > 0);
  return out;
};
const u32le = (n: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, true);
  return out;
};

/** A RAR 5 header block: CRC32, size, the fields (type, flags, ...), then its data area. */
function block5(fields: number[], data: Uint8Array = new Uint8Array(0)) {
  const body = new Uint8Array(fields);
  const head = concat([new Uint8Array(vint(body.length)), body]);
  return concat([u32le(crc32(head)), head, data]);
}

const RAR5 = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);

/** A RAR 5 archive of stored files, each with its CRC32, as rar -m0 writes them. */
export function rar5Stored(entries: Entry[]): Uint8Array {
  const files = entries.map(([name, raw]) => {
    const data = bytesOf(raw);
    const encoded = [...new TextEncoder().encode(name)];
    // Type 2 (file), data area; CRC32 present, size, attributes, CRC, stored, Windows, the name.
    const fields = [2, 2, ...vint(data.length), 4, ...vint(data.length), 0x20];
    fields.push(...u32le(crc32(data)), 0, 0, ...vint(encoded.length), ...encoded);
    return block5(fields, data);
  });
  return concat([RAR5, block5([1, 0, 0]), ...files, block5([5, 0, 0])]);
}

/** A RAR 4 or 5 archive with some file names changed for names of the same length. */
export function renamed(bytes: Uint8Array, names: Record<string, string>): Uint8Array {
  const out = bytes.slice();
  const swap = (from: number, to: number) => {
    for (const [old, name] of Object.entries(names)) {
      if (old.length !== name.length) throw new Error(`${name} is not as long as ${old}`);
      // RAR 4 keeps the separators Windows wrote.
      for (const [was, now] of [
        [old, name],
        [old.replaceAll("/", "\\"), name.replaceAll("/", "\\")],
      ]) {
        const at = Buffer.from(out.subarray(from, to)).indexOf(was ?? "", 0, "latin1");
        if (at >= 0) out.set(new TextEncoder().encode(now), from + at);
      }
    }
  };
  const view = new DataView(out.buffer);
  if (out[6] === 0x01) {
    for (let at = 8; at + 7 < out.length; ) {
      let size = 0;
      let length = 0;
      for (let shift = 1; ; length++, shift *= 128) {
        const b = out[at + 4 + length] ?? 0;
        size += (b & 0x7f) * shift;
        if (!(b & 0x80)) break;
      }
      const end = at + 4 + length + 1 + size;
      let f = at + 5 + length;
      const next = () => {
        let v = 0;
        for (let shift = 1; ; shift *= 128) {
          const b = out[f++] ?? 0;
          v += (b & 0x7f) * shift;
          if (!(b & 0x80)) return v;
        }
      };
      const type = next();
      const flags = next();
      if (flags & 1) next();
      const data = flags & 2 ? next() : 0;
      if (type === 2 || type === 3) {
        swap(f, end);
        view.setUint32(at, crc32(out.subarray(at + 4, end)), true);
      }
      if (type === 5) break;
      at = end + data;
    }
    return out;
  }
  for (let at = 7; at + 7 <= out.length; ) {
    const type = out[at + 2];
    const flags = view.getUint16(at + 3, true);
    const size = view.getUint16(at + 5, true);
    let add = flags & 0x8000 ? view.getUint32(at + 7, true) : 0;
    if (type === 0x74) {
      if (flags & 0x100) add += view.getUint32(at + 32, true) * 2 ** 32;
      swap(at + 7, at + size);
      view.setUint16(at, crc32(out.subarray(at + 2, at + size)) & 0xffff, true);
    }
    if (type === 0x7b || size < 7) break;
    at += size + add;
  }
  return out;
}

/** Bytes as the Source the readers take, keeping the reads and counting the bytes read. */
export function counted(bytes: Uint8Array) {
  const source = {
    size: bytes.length,
    bytesRead: 0,
    reads: [] as Array<[offset: number, length: number]>,
    async read(offset: number, length: number) {
      const part = bytes.subarray(offset, Math.min(bytes.length, offset + length));
      source.bytesRead += part.length;
      source.reads.push([offset, part.length]);
      return part;
    },
  };
  return source;
}
