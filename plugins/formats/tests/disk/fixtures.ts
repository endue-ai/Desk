// The images make-fixtures.sh built with the real tools, what the kernel saw in them, and helpers
// over the disk readers' public functions.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Archive, Entry } from "../../lib/disk/archive.js";
import { memorySource, type Source } from "../../lib/disk/source.js";

const dir = join(import.meta.dirname, "fixtures");

export interface Expected {
  path: string;
  kind: "file" | "folder" | "link";
  size: number;
  mtime: number;
  sha256?: string;
  link?: string;
  inode?: number;
}
interface Fixtures {
  when: number;
  filesystems: Record<string, { type: string; label: string; size: number; entries: Expected[] }>;
  disks: Record<
    string,
    {
      size: number;
      sha256: string;
      partitions: { number: number; start: number; size: number; entries: Expected[] }[];
    }
  >;
  big: { size: number; markers: { offset: number; length: number; sha256: string }[] };
}
export const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Fixtures;

const images = new Map<string, Uint8Array>();
/** A fixture image as the tool wrote it (they are kept gzipped). */
export function image(name: string): Uint8Array {
  let bytes = images.get(name);
  if (!bytes) {
    bytes = new Uint8Array(gunzipSync(readFileSync(join(dir, `${name}.gz`))));
    images.set(name, bytes);
  }
  return bytes;
}
/** A copy of a fixture, to damage. */
export const copy = (name: string) => image(name).slice();

/** The first 16 hex digits of the SHA-256, as expected.json keeps them. */
export const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 16);
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A source over the bytes that counts the reads and the bytes read. */
export function counted(bytes: Uint8Array, onRead?: (reads: number) => void) {
  const memory = memorySource(bytes);
  const counter = { reads: 0, bytes: 0 };
  const source: Source = {
    size: memory.size,
    read: (offset, length) => {
      counter.reads++;
      counter.bytes += Math.max(0, Math.min(length, memory.size - offset));
      onRead?.(counter.reads);
      return memory.read(offset, length);
    },
  };
  return { source, counter };
}

/** The SHA-256 of a whole source, read 1 MiB at a time. */
export async function sourceHash(source: Source) {
  const hash = createHash("sha256");
  for (let at = 0; at < source.size; at += 1 << 20) hash.update(await source.read(at, 1 << 20));
  return hash.digest("hex");
}

export const paths = (archive: Archive) => archive.entries.map((e) => e.path).sort();
export function entry(archive: Archive, path: string): Entry {
  const found = archive.entries.find((e) => e.path === path);
  if (!found) throw new Error(`no ${path} in ${paths(archive).slice(0, 40).join(", ")}`);
  return found;
}
export const detail = (archive: Archive, label: string) =>
  archive.details.find((d) => d.label === label)?.value;
export const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A date stored as local wall-clock time (FAT), read back as the UTC seconds it spelled. */
export const wallClock = (date: Date) =>
  Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ) / 1000;
