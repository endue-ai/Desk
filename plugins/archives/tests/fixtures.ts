// The fixtures make-fixtures.py made with the real tools, and small archives built here byte by byte.
// The codec streams and the 7z archives live beside the decoders and the reader in endue.formats.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, gunzipSync } from "node:zlib";
import { openArchive } from "../ui/formats/index.js";
import { memorySource } from "../ui/source.js";

const dir = join(import.meta.dirname, "fixtures");
const library = join(import.meta.dirname, "../../formats/tests");
/** Where make-fixtures.py wrote `name`: the library's codec and 7z folders, or here. */
const folder = (name: string) =>
  /^(text[.-]|hello\.txt\.gz$)/.test(name)
    ? join(library, "codecs/fixtures")
    : name.endsWith(".7z")
      ? join(library, "sevenzip/fixtures")
      : dir;

export const fixture = (name: string) => new Uint8Array(readFileSync(join(folder(name), name)));
/** Disk images are kept gzipped; this is the image the tool wrote. */
export const gunzipped = (name: string) =>
  new Uint8Array(gunzipSync(readFileSync(join(dir, name))));
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
export const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as {
  text: { size: number; sha256: string };
  words: { size: number; sha256: string };
  torrent: { infoHash: string };
};

/** What make-fixtures.py put in its tree. */
export const TREE = {
  hello: "Hello, archives!\n",
  readme: "# Sample\n\nA small tree for the archives plugin's tests.\n",
  korean: "안녕하세요\n",
  koreanName: "docs/한글.txt",
  long: "deep/a-very-long-folder-name-that-goes-on-and-on/another-long-folder-name-for-the-tar-tests/file-with-a-long-name.txt",
};
export const WHEN = "2026-10-01T12:00:00.000Z";

export type Archive = Awaited<ReturnType<typeof openArchive>>;
export type Entry = Archive["entries"][number];

export const open = (bytes: Uint8Array, name: string) => openArchive(memorySource(bytes), name);
/** The paths of the archive's files (not folders), sorted. */
export const files = (archive: Archive) =>
  archive.entries
    .filter((e) => e.kind !== "folder")
    .map((e) => e.path)
    .sort();
export function entry(archive: Archive, path: string): Entry {
  const found = archive.entries.find((e) => e.path === path);
  if (!found) throw new Error(`no ${path} in ${archive.entries.map((e) => e.path).join(", ")}`);
  return found;
}
export const read = async (archive: Archive, path: string) =>
  utf8(await archive.read(entry(archive, path)));
export const detail = (archive: Archive, label: string) =>
  archive.details.find((d) => d.label === label)?.value;

export interface ZipFile {
  name: string;
  data?: string | Uint8Array;
  /** Deflate the data (method 8); stored otherwise. */
  deflate?: boolean;
  /** A symbolic link to this target (Unix mode in the external attributes). */
  link?: string;
  /** Mark the entry encrypted (general purpose bit 0). */
  encrypted?: boolean;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A ZIP written the plain way (local headers, central directory, end record), UTF-8 names. */
export function zipOf(entries: ZipFile[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of entries) {
    const name = new TextEncoder().encode(file.name);
    const raw =
      typeof file.data === "string"
        ? new TextEncoder().encode(file.data)
        : (file.data ?? new TextEncoder().encode(file.link ?? ""));
    const packed = file.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const flags = 0x800 | (file.encrypted ? 1 : 0);
    const mode = file.link ? 0o120777 : file.name.endsWith("/") ? 0o40755 : 0o100644;
    const head = (signature: number, size: number) => {
      const b = new DataView(new ArrayBuffer(size));
      b.setUint32(0, signature, true);
      return b;
    };
    const local = head(0x04034b50, 30);
    const fields = (b: DataView, at: number) => {
      b.setUint16(at, 20, true);
      b.setUint16(at + 2, flags, true);
      b.setUint16(at + 4, file.deflate ? 8 : 0, true);
      b.setUint16(at + 6, 0x6000, true); // 12:00
      b.setUint16(at + 8, ((2026 - 1980) << 9) | (10 << 5) | 1, true);
      b.setUint32(at + 10, crc32(raw), true);
      b.setUint32(at + 14, packed.length, true);
      b.setUint32(at + 18, raw.length, true);
      b.setUint16(at + 22, name.length, true);
    };
    fields(local, 4);
    const cd = head(0x02014b50, 46);
    cd.setUint16(4, 0x0314, true); // made by Unix
    fields(cd, 6);
    cd.setUint32(38, (mode << 16) >>> 0, true);
    cd.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, packed);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + packed.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = head22(entries.length, cdSize, offset);
  return concat([...parts, ...central, end]);
}

function head22(count: number, size: number, offset: number) {
  const b = new DataView(new ArrayBuffer(22));
  b.setUint32(0, 0x06054b50, true);
  b.setUint16(8, count, true);
  b.setUint16(10, count, true);
  b.setUint32(12, size, true);
  b.setUint32(16, offset, true);
  return new Uint8Array(b.buffer);
}

export function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Bytes that do not compress and are not text: a fixed xorshift sequence. */
export function noise(length: number, seed = 161) {
  const out = new Uint8Array(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}
