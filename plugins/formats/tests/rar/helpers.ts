// Shared by the RAR tests: fixtures from make-fixtures.sh, the originals made again by the seeded
// generator they came from, and checks that a decode matches them.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "../../lib/rar/crc32.js";
import { openRar } from "../../lib/rar/index.js";
import { LINKS, ORIGINALS, random } from "./originals.mjs";

export { random };

const dir = join(import.meta.dirname, "fixtures");

export type Archive = Awaited<ReturnType<typeof openRar>>;
export type Entry = Archive["entries"][number];
export type Path = keyof typeof ORIGINALS;

export const fixture = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hashes = JSON.parse(readFileSync(join(dir, "originals.json"), "utf8")) as Record<
  string,
  { size: number; sha256: string }
>;

/** A source over bytes that counts its reads. */
export function memory(bytes: Uint8Array) {
  const source = {
    size: bytes.length,
    reads: 0,
    read: async (offset: number, length: number) => {
      source.reads++;
      return bytes.subarray(
        Math.min(offset, bytes.length),
        Math.min(bytes.length, offset + length),
      );
    },
  };
  return source;
}

export const open = (bytes: Uint8Array, options?: Parameters<typeof openRar>[1]) =>
  openRar(memory(bytes), options);
export const openFixture = (name: string, options?: Parameters<typeof openRar>[1]) =>
  open(fixture(name), options);

const made = new Map<string, Uint8Array>();
/** The original bytes of `path`, checked against the hashes recorded when the fixtures were made. */
export function original(path: Path) {
  let bytes = made.get(path);
  if (!bytes) {
    bytes = ORIGINALS[path]();
    if (sha256(bytes) !== hashes[path]?.sha256)
      throw new Error(`originals.mjs no longer makes ${path}`);
    made.set(path, bytes);
  }
  return bytes;
}

export const entry = (archive: Archive, path: string) => {
  const found = archive.entries.find((e) => e.path === path);
  if (!found) throw new Error(`${path} is not in the archive`);
  return found;
};

/** Reads every listed path and checks its bytes, size and CRC against the original. */
export async function expectOriginals(archive: Archive, paths: Path[]) {
  for (const path of paths) {
    const e = entry(archive, path);
    const bytes = await archive.read(e);
    const want = original(path);
    if (e.size !== want.length)
      throw new Error(`${path}: listed as ${e.size} bytes, not ${want.length}`);
    if (bytes.length !== want.length || sha256(bytes) !== sha256(want))
      throw new Error(`${path}: the decoded bytes differ from the original`);
    if (crc32(bytes) !== crc32(want)) throw new Error(`${path}: CRC differs`);
  }
}

export const TREE: Path[] = [
  "text.txt",
  "data.bin",
  "empty.txt",
  "docs/notes/readme.md",
  "unicode/Ünïcödé.txt",
  "unicode/日本語.txt",
  "unicode/한국어 이름.txt",
];
export const FEW: Path[] = TREE.filter((p) => p !== "text.txt");
export const FOLDERS = ["docs", "docs/notes", "empty-folder", "unicode"];
export const LINK = Object.entries(LINKS)[0] as [string, string];

/** Milliseconds `work` took to settle, and how it settled. */
export async function timed<T>(work: () => Promise<T>) {
  const start = performance.now();
  try {
    const value = await work();
    return { ms: performance.now() - start, value, error: undefined };
  } catch (error) {
    return { ms: performance.now() - start, value: undefined, error: error as Error };
  }
}
