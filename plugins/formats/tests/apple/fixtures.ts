// The images and streams make-fixtures.py built with hdiutil, diskutil, ditto and Apple's
// encoders, what the kernel saw in them, and helpers over the readers' public functions.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
  compressed?: boolean;
}
type Volumes = Record<string, Expected[]>;
interface Disk {
  size: number;
  sha256: string;
}
interface Fixtures {
  when: number;
  hfs: { formats: Record<string, string>; disk: Disk; volumes: Volumes };
  hfsx: { file: string; disk: Disk; volumes: Volumes };
  apm: { file: string; disk: Disk; volumes: Volumes };
  apfs: { file: string; disk: Disk; volumes: Volumes };
  encrypted: { file: string };
  "apfs-locked": { file: string; volume: string };
  streams: Record<string, { size: number; sha256: string }>;
}
export const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Fixtures;

const files = new Map<string, Uint8Array>();
/** A fixture as the tool wrote it (the two that hardly compress are kept gzipped). */
export function bytes(name: string): Uint8Array {
  let got = files.get(name);
  if (!got) {
    const plain = join(dir, name);
    got = existsSync(plain)
      ? new Uint8Array(readFileSync(plain))
      : new Uint8Array(gunzipSync(readFileSync(`${plain}.gz`)));
    files.set(name, got);
  }
  return got;
}
/** A fixture as a Source. */
export const fixture = (name: string): Source => memorySource(bytes(name));
/** A copy of a fixture, to damage. */
export const copy = (name: string) => bytes(name).slice();

export const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
/** The first 16 hex digits of the SHA-256, as expected.json keeps them for files. */
export const sha = (data: Uint8Array) => sha256(data).slice(0, 16);

/** A source over the bytes that counts the reads and the bytes read. */
export function counted(data: Uint8Array) {
  const memory = memorySource(data);
  const counter = { reads: 0, bytes: 0 };
  const source: Source = {
    size: memory.size,
    read: (offset, length) => {
      counter.reads++;
      counter.bytes += Math.max(0, Math.min(length, memory.size - offset));
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
export const detail = (archive: Pick<Archive, "details">, label: string) =>
  archive.details.find((d) => d.label === label)?.value;
export const utf8 = (data: Uint8Array) => new TextDecoder().decode(data);

/**
 * Check an archive's entries against what the kernel listed: the same paths, kinds, sizes, link
 * targets and modification times, and every file's bytes (`prefix` is the volume's folder).
 */
export async function matches(archive: Archive, want: Expected[], prefix = "") {
  const at = (path: string) => (prefix ? `${prefix}/${path}` : path);
  const got = paths(archive).filter((p) => !prefix || p.startsWith(`${prefix}/`));
  const problems: string[] = [];
  const wanted = want.map((e) => at(e.path)).sort();
  if (JSON.stringify(got) !== JSON.stringify(wanted))
    problems.push(
      `paths differ: got ${got.filter((p) => !wanted.includes(p))}, missing ${wanted.filter((p) => !got.includes(p))}`,
    );
  for (const file of want) {
    const found = archive.entries.find((e) => e.path === at(file.path));
    if (!found) continue;
    if (found.kind !== file.kind || found.size !== file.size)
      problems.push(`${file.path}: ${found.kind} ${found.size}, want ${file.kind} ${file.size}`);
    if (file.link !== undefined && found.link !== file.link)
      problems.push(`${file.path}: link ${found.link}, want ${file.link}`);
    if (Math.abs((found.date?.getTime() ?? 0) / 1000 - file.mtime) > 0.001)
      problems.push(`${file.path}: date ${found.date?.toISOString()}, want ${file.mtime}`);
    if (file.kind === "file") {
      const data = await archive.read(found);
      if (sha(data) !== file.sha256) problems.push(`${file.path}: bytes differ (${data.length})`);
    }
  }
  return problems;
}
