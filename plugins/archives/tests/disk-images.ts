// Disk images built in memory from the file-system images the library's tests keep (made with
// mkfs.fat, mke2fs and mkntfs): a GPT disk around them, and qemu-img's empty dynamic VHDX given
// that disk as its payload. Nothing here is written to the fixtures folder.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, gunzipSync } from "node:zlib";

const library = join(import.meta.dirname, "../../formats/tests");
const SECTOR = 512;
const MIB = 1024 * 1024;

/** A file of the library's tests, gunzipped when it is kept gzipped. */
export function libraryFixture(path: string): Uint8Array {
  const raw = readFileSync(join(library, path));
  return new Uint8Array(path.endsWith(".gz") ? gunzipSync(raw) : raw);
}

/** The library's expected entries of one file-system image: path, kind, size, first 16 hex of SHA-256. */
export function libraryEntries(image: string) {
  return readFileSync(join(library, "disk/fixtures/entries.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          image: string;
          partition?: number;
          path: string;
          kind: string;
          size: number;
          sha256?: string;
          inode?: number;
        },
    )
    .filter((e) => e.image === image && e.partition === undefined);
}

/** A GUID's 16 bytes as GPT stores them: the first three groups little-endian. */
export function guidBytes(text: string): Uint8Array {
  const hex = text.replace(/-/g, "");
  const bytes = Uint8Array.from({ length: 16 }, (_, i) =>
    Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16),
  );
  const swap = (from: number, length: number) => bytes.subarray(from, from + length).reverse();
  swap(0, 4);
  swap(4, 2);
  swap(6, 2);
  return bytes;
}

export const MICROSOFT_DATA = "EBD0A0A2-B9E5-4433-87C0-68B6B72699C7";
export const LINUX_DATA = "0FC63DAF-8483-4772-8E79-3D69D8477DE4";

export interface Part {
  /** The partition's GPT name. */
  name: string;
  /** The type GUID, as written. */
  type: string;
  /** The volume, put at the next MiB. */
  bytes: Uint8Array;
}

const ENTRIES = 128;
const ENTRY = 128;
const TABLE = (ENTRIES * ENTRY) / SECTOR;

/** The GPT header for `lba`, its backup at `other`, the entries at `table`. */
function header(lba: number, other: number, table: number, last: number, entries: Uint8Array) {
  const b = new Uint8Array(SECTOR);
  const v = new DataView(b.buffer);
  b.set(new TextEncoder().encode("EFI PART"), 0);
  v.setUint32(8, 0x00010000, true);
  v.setUint32(12, 92, true);
  v.setBigUint64(24, BigInt(lba), true);
  v.setBigUint64(32, BigInt(other), true);
  v.setBigUint64(40, BigInt(2 + TABLE), true);
  v.setBigUint64(48, BigInt(last - 1 - TABLE), true);
  b.set(guidBytes("5A1E5A1E-0194-4000-8000-000000000194"), 56);
  v.setBigUint64(72, BigInt(table), true);
  v.setUint32(80, ENTRIES, true);
  v.setUint32(84, ENTRY, true);
  v.setUint32(88, crc32(entries) >>> 0, true);
  v.setUint32(16, crc32(b.subarray(0, 92)) >>> 0, true);
  return b;
}

/**
 * A GPT disk holding `parts` one after another from 1 MiB, each at a MiB boundary, with a protective
 * MBR and the backup table at the end; `size` (a whole number of MiB) when the disk is larger.
 */
export function gptOf(parts: Part[], size?: number): Uint8Array {
  let at = MIB;
  const placed = parts.map((part) => {
    const start = at;
    at += Math.ceil(part.bytes.length / MIB) * MIB;
    return { part, start };
  });
  const total = Math.max(size ?? 0, at + MIB);
  const disk = new Uint8Array(total);
  const last = total / SECTOR - 1;
  const entries = new Uint8Array(ENTRIES * ENTRY);
  placed.forEach(({ part, start }, i) => {
    disk.set(part.bytes, start);
    const e = entries.subarray(i * ENTRY, (i + 1) * ENTRY);
    const v = new DataView(e.buffer, e.byteOffset, ENTRY);
    e.set(guidBytes(part.type), 0);
    e.set(guidBytes(`5A1E5A1E-0194-4000-8000-00000000000${i + 1}`), 16);
    v.setBigUint64(32, BigInt(start / SECTOR), true);
    v.setBigUint64(40, BigInt((start + part.bytes.length) / SECTOR - 1), true);
    for (let c = 0; c < part.name.length && c < 36; c++)
      v.setUint16(56 + c * 2, part.name.charCodeAt(c), true);
  });
  // The protective MBR: one partition of type 0xEE over the whole disk.
  const mbr = new DataView(disk.buffer, 0, SECTOR);
  disk[446 + 4] = 0xee;
  mbr.setUint32(446 + 8, 1, true);
  mbr.setUint32(446 + 12, Math.min(last, 0xffffffff), true);
  mbr.setUint16(510, 0xaa55, true);
  disk.set(header(1, last, 2, last, entries), SECTOR);
  disk.set(entries, 2 * SECTOR);
  disk.set(entries, (last - TABLE) * SECTOR);
  disk.set(header(last, 1, last - TABLE, last, entries), last * SECTOR);
  return disk;
}

const BAT = "2DC27766-F623-4200-9D64-115E9BFD4A08";
const METADATA = "8B7CA206-4790-4B9A-B8FE-575F050F886E";
const FILE_PARAMETERS = "CAA16737-FA36-4D43-B3B6-33F0AA44E76B";
const VIRTUAL_SIZE = "2FA54224-CD1B-4876-B211-5DBED83BF4B8";
const FULLY_PRESENT = 6n;

const same = (bytes: Uint8Array, at: number, guid: string) =>
  guidBytes(guid).every((b, i) => bytes[at + i] === b);

/**
 * qemu-img's empty dynamic 64 MiB VHDX (tests/fixtures/disk.vhdx.gz) with `disk` as its virtual
 * disk: each block that is not all zeros is added at the end of the file, at a MiB boundary, and
 * its BAT entry marked fully present. The headers and region table, which carry checksums, stay.
 */
export function vhdxWith(disk: Uint8Array): Uint8Array {
  const empty = new Uint8Array(
    gunzipSync(readFileSync(join(import.meta.dirname, "fixtures/disk.vhdx.gz"))),
  );
  const view = new DataView(empty.buffer, empty.byteOffset, empty.byteLength);
  const regions = 192 * 1024;
  let bat = 0;
  let meta = 0;
  for (let i = 0; i < view.getUint32(regions + 8, true); i++) {
    const e = regions + 16 + i * 32;
    if (same(empty, e, BAT)) bat = Number(view.getBigUint64(e + 16, true));
    if (same(empty, e, METADATA)) meta = Number(view.getBigUint64(e + 16, true));
  }
  let blockSize = 0;
  let size = 0;
  for (let j = 0; j < view.getUint16(meta + 10, true); j++) {
    const e = meta + 32 + j * 32;
    const value = meta + view.getUint32(e + 16, true);
    if (same(empty, e, FILE_PARAMETERS)) blockSize = view.getUint32(value, true);
    if (same(empty, e, VIRTUAL_SIZE)) size = Number(view.getBigUint64(value, true));
  }
  if (!bat || !blockSize || disk.length > size)
    throw new Error("disk.vhdx is not the image expected");
  const chunkRatio = (2 ** 23 * SECTOR) / blockSize;
  const blocks: { index: number; bytes: Uint8Array }[] = [];
  for (let index = 0; index * blockSize < disk.length; index++) {
    const bytes = disk.subarray(index * blockSize, (index + 1) * blockSize);
    if (bytes.some((b) => b !== 0)) blocks.push({ index, bytes });
  }
  const base = Math.ceil(empty.length / MIB) * MIB;
  const out = new Uint8Array(base + blocks.length * blockSize);
  out.set(empty);
  const bats = new DataView(out.buffer);
  blocks.forEach(({ index, bytes }, i) => {
    const at = base + i * blockSize;
    out.set(bytes, at);
    const slot = index + Math.floor(index / chunkRatio);
    bats.setBigUint64(bat + slot * 8, (BigInt(at / MIB) << 20n) | FULLY_PRESENT, true);
  });
  return out;
}
