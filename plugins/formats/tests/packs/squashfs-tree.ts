// The tree the SquashFS tests write with every compressor, what a reader should list from it, and
// small helpers over archives and sources.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import type { Archive, Entry } from "../../lib/disk/archive.js";
import { memorySource, type Source } from "../../lib/disk/source.js";
import { mixed, noise, text } from "./samples";
import type { SqDir, SqFile, SqNode } from "./squashfs-builder";

const enc = (s: string) => new TextEncoder().encode(s);
export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

/** Files, folders, links, a hard link, devices, an empty folder and a deep one; 4 KiB blocks. */
export function sampleTree(): SqDir {
  const readme: SqFile = {
    kind: "file",
    name: "readme.md",
    data: enc("# Sample\n\nA small tree for the pack tests.\n"),
    mtime: 1790000000,
  };
  let deep: SqNode = { kind: "file", name: "deep.txt", data: text(5000, 9) };
  for (const name of ["f", "e", "d", "c", "b", "a"])
    deep = { kind: "dir", name, children: [deep], mtime: 1790000100 };
  return {
    kind: "dir",
    name: "",
    children: [
      {
        kind: "dir",
        name: "docs",
        children: [
          readme,
          { kind: "hardlink", name: "again.md", to: readme },
          { kind: "file", name: "한글.txt", data: enc("안녕하세요\n") },
        ],
      },
      { kind: "dir", name: "deep", children: [deep] },
      { kind: "file", name: "big.bin", data: mixed(4096 * 3 + 1500, 3000, 4) },
      { kind: "file", name: "exact.bin", data: text(8192, 5) },
      { kind: "file", name: "noise.bin", data: noise(6000, 6) },
      { kind: "file", name: "empty.txt", data: new Uint8Array(0) },
      { kind: "symlink", name: "link", target: "docs/readme.md" },
      { kind: "symlink", name: "up", target: "../outside" },
      {
        kind: "dir",
        name: "dev",
        children: [
          { kind: "char", name: "null", device: 0x103 },
          { kind: "block", name: "sda", device: 0x800 },
          { kind: "fifo", name: "pipe" },
          { kind: "socket", name: "sock" },
        ],
      },
      { kind: "dir", name: "empty", children: [] },
    ],
  };
}

export type Want = {
  path: string;
  kind: Entry["kind"];
  size: number;
  data?: Uint8Array;
  link?: string;
  device?: boolean;
};
/** What a reader should list from a tree: folders before what they hold. */
export function wanted(root: SqDir, prefix = ""): Want[] {
  const out: Want[] = [];
  for (const node of root.children) {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    const real = node.kind === "hardlink" ? node.to : node;
    if (real.kind === "dir") out.push({ path, kind: "folder", size: 0 }, ...wanted(real, path));
    else if (real.kind === "file")
      out.push({ path, kind: "file", size: real.data.length, data: real.data });
    else if (real.kind === "symlink")
      out.push({ path, kind: "link", size: enc(real.target).length, link: real.target });
    else out.push({ path, kind: "file", size: 0, device: true });
  }
  return out;
}

/** The archive lists what the tree holds and reads every file to the byte. */
export async function expectTree(archive: Archive, root: SqDir, prefix = "") {
  const want = wanted(root, prefix);
  expect(archive.entries.map((e) => e.path).sort()).toEqual(want.map((w) => w.path).sort());
  for (const w of want) {
    const e = entry(archive, w.path);
    expect([e.path, e.kind, e.size]).toEqual([w.path, w.kind, w.size]);
    if (w.link !== undefined) expect(e.link).toBe(w.link);
    if (w.device) {
      expect(e.refusal).toBe("Devices, pipes and sockets hold no data.");
      await expect(archive.read(e)).rejects.toThrow(/hold no data/);
    } else if (w.data) expect(sha256(await archive.read(e))).toBe(sha256(w.data));
  }
}

export function entry(archive: Archive, path: string) {
  const found = archive.entries.find((e) => e.path === path);
  if (!found) throw new Error(`no ${path} in ${archive.entries.map((e) => e.path).join(", ")}`);
  return found;
}
export const detail = (archive: Archive, label: string) =>
  archive.details.find((d) => d.label === label)?.value;

/** A source over the bytes that counts the bytes read, by where they were. */
export function counted(bytes: Uint8Array) {
  const memory = memorySource(bytes);
  const count = { bytes: 0, reads: [] as [number, number][] };
  const source: Source = {
    size: memory.size,
    read: (offset, length) => {
      count.bytes += Math.max(0, Math.min(length, memory.size - offset));
      count.reads.push([offset, length]);
      return memory.read(offset, length);
    },
  };
  return { source, count };
}

/** The worst gap between turns of the event loop while `work` runs. */
export async function worstGap<T>(work: () => Promise<T>) {
  let worst = 0;
  let last = performance.now();
  let done = false;
  const beat = () => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
    if (!done) setTimeout(beat, 0);
  };
  setTimeout(beat, 0);
  const result = await work();
  done = true;
  return { worst, result };
}
