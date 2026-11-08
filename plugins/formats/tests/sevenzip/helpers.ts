// The 7z fixtures plugins/archives/tests/make-fixtures.py had 7-Zip write (make-fixtures-linux.sh),
// what its tree holds, and helpers over the reader's public function.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openSevenZip } from "@endue-ai/formats/sevenzip/index.js";

const dir = join(import.meta.dirname, "fixtures");

export const fixture = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
/** The size and SHA-256 of words.txt. */
export const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as {
  words: { size: number; sha256: string };
};

/** What make-fixtures.py put in its tree. */
export const TREE = {
  hello: "Hello, archives!\n",
  readme: "# Sample\n\nA small tree for the archives plugin's tests.\n",
  korean: "안녕하세요\n",
  koreanName: "docs/한글.txt",
};
export const WHEN = "2026-10-01T12:00:00.000Z";

export type Source = { size: number; read(offset: number, length: number): Promise<Uint8Array> };
export type Archive = Awaited<ReturnType<typeof openSevenZip>>;
export type Entry = Archive["entries"][number];

/** Bytes as a Source, the shape every reader of the library takes. */
export const memorySource = (bytes: Uint8Array): Source => ({
  size: bytes.length,
  read: async (offset, length) =>
    bytes.subarray(Math.min(offset, bytes.length), Math.min(bytes.length, offset + length)),
});
export const open = (name: string) => openSevenZip(memorySource(fixture(name)), name);
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
