// ext2/3/4 inodes: their fields, where a file's data lives (an extent tree, or the direct and
// indirect block maps of ext2 and ext3), data kept inline in the inode itself, and reading a file
// in a few large reads. From the ext4 disk layout documentation.
import { latin1, text, u16, u32 } from "./bytes.js";
import { damaged } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/**
 * @typedef {{ source: Source, type: string, bs: number, largeDir: boolean }} Volume
 * @typedef {{ ino: number, mode: number, size: number, flags: number, block: Uint8Array,
 *   raw: Uint8Array, date?: Date }} Inode
 * @typedef {{ logical: number, count: number, physical: number }} Run blocks `logical` to
 * `logical + count - 1` of a file, at block `physical` of the volume.
 */

export const S_IFMT = 0xf000;
export const S_IFDIR = 0x4000;
export const S_IFREG = 0x8000;
export const S_IFLNK = 0xa000;
export const FLAG_ENCRYPT = 0x800;
export const FLAG_EXTENTS = 0x80000;
export const FLAG_INLINE = 0x10000000;
const EXTENT_MAGIC = 0xf30a;
const CHUNK = 4 * 1024 * 1024;

/** @param {Volume} vol @param {number} ino @param {Uint8Array} raw @returns {Inode} */
export function parseInode(vol, ino, raw) {
  const mode = u16(raw, 0);
  const flags = u32(raw, 0x20);
  const directory = (mode & S_IFMT) === S_IFDIR;
  const high = directory && !vol.largeDir ? 0 : u32(raw, 0x6c);
  const size = u32(raw, 4) + high * 2 ** 32;
  // Seconds are signed; large inodes extend them with two epoch bits and add nanoseconds.
  let seconds = u32(raw, 0x10) | 0;
  let nanos = 0;
  if (raw.length > 128 && u16(raw, 0x80) >= 0x0c) {
    const extra = u32(raw, 0x88);
    seconds += (extra & 3) * 2 ** 32;
    nanos = extra >>> 2;
  }
  const date = seconds ? new Date(seconds * 1000 + Math.floor(nanos / 1e6)) : undefined;
  return { ino, mode, size, flags, block: raw.subarray(0x28, 0x28 + 60), raw, date };
}

/**
 * The value of the inode's "system.data" extended attribute, kept in the inode body after its
 * extra fields: the part of inline data that does not fit in i_block.
 * @param {Uint8Array} raw
 */
export function systemData(raw) {
  if (raw.length <= 128) return undefined;
  const start = 128 + u16(raw, 0x80);
  if (start + 4 > raw.length || u32(raw, start) !== 0xea020000) return undefined;
  const base = start + 4;
  for (let pos = base; pos + 16 <= raw.length && u32(raw, pos) !== 0; ) {
    const nameLength = raw[pos] ?? 0;
    const index = raw[pos + 1] ?? 0;
    if (index === 7 && latin1(raw.subarray(pos + 16, pos + 16 + nameLength)) === "data") {
      const offset = base + u16(raw, pos + 2);
      return raw.subarray(offset, Math.min(raw.length, offset + u32(raw, pos + 8)));
    }
    pos += (16 + nameLength + 3) & ~3;
  }
  return undefined;
}

/** An inline file's bytes: i_block, then the system.data value. @param {Inode} inode */
export function inlineData(inode) {
  const more = systemData(inode.raw) ?? new Uint8Array(0);
  const out = new Uint8Array(60 + more.length);
  out.set(inode.block);
  out.set(more, 60);
  return out.subarray(0, Math.min(out.length, inode.size));
}

/** A block of the volume, whole. @param {Volume} vol @param {number} block */
async function readBlock(vol, block) {
  const bytes = await vol.source.read(block * vol.bs, vol.bs);
  if (bytes.length < vol.bs)
    throw damaged(`A block map of the ${vol.type} volume goes past its end.`);
  return bytes;
}

/**
 * The runs of an extent tree node, in file order, up to block `blocks`. Uninitialized extents
 * and holes give no run: they read as zeros.
 * @param {Volume} vol @param {Uint8Array} node @param {number} blocks
 * @param {import("./work.js").Work} work @param {number} depth
 * @returns {AsyncGenerator<Run>}
 */
async function* extentRuns(vol, node, blocks, work, depth) {
  const entries = u16(node, 2);
  const level = u16(node, 6);
  if (u16(node, 0) !== EXTENT_MAGIC || depth > 8 || 12 + entries * 12 > node.length)
    throw damaged(`An extent tree on the ${vol.type} volume is damaged.`);
  for (let i = 0; i < entries; i++) {
    const e = 12 + i * 12;
    const logical = u32(node, e);
    if (logical >= blocks) break;
    if (level === 0) {
      let count = u16(node, e + 4);
      const uninitialized = count > 32768;
      if (uninitialized) count -= 32768;
      const physical = u16(node, e + 6) * 2 ** 32 + u32(node, e + 8);
      if (!uninitialized && count && physical) yield { logical, count, physical };
    } else {
      await work.tick();
      const child = u32(node, e + 4) + u16(node, e + 8) * 2 ** 32;
      yield* extentRuns(vol, await readBlock(vol, child), blocks, work, depth + 1);
    }
  }
}

/**
 * The runs of an indirect block at `level` (1 single, 2 double, 3 triple) that starts at file
 * block `logical`.
 * @param {Volume} vol @param {number} block @param {number} level @param {number} logical
 * @param {number} blocks @param {import("./work.js").Work} work @returns {AsyncGenerator<Run>}
 */
async function* indirect(vol, block, level, logical, blocks, work) {
  await work.tick();
  const table = await readBlock(vol, block);
  const per = vol.bs / 4;
  const span = per ** (level - 1);
  for (let i = 0; i < per && logical + i * span < blocks; i++) {
    const next = u32(table, i * 4);
    if (!next) continue;
    if (level === 1) yield { logical: logical + i, count: 1, physical: next };
    else yield* indirect(vol, next, level - 1, logical + i * span, blocks, work);
  }
}

/**
 * The runs of ext2 and ext3's block map: twelve direct blocks, then single, double and triple
 * indirect ones.
 * @param {Volume} vol @param {Uint8Array} map i_block @param {number} blocks
 * @param {import("./work.js").Work} work @returns {AsyncGenerator<Run>}
 */
async function* blockMapRuns(vol, map, blocks, work) {
  for (let i = 0; i < 12 && i < blocks; i++) {
    const physical = u32(map, i * 4);
    if (physical) yield { logical: i, count: 1, physical };
  }
  const per = vol.bs / 4;
  let logical = 12;
  for (let level = 1; level <= 3 && logical < blocks; level++) {
    const block = u32(map, (11 + level) * 4);
    if (block) yield* indirect(vol, block, level, logical, blocks, work);
    logical += per ** level;
  }
}

/**
 * The file's runs up to block `blocks`, neighbours that follow each other on the volume joined.
 * @param {Volume} vol @param {Inode} inode @param {number} blocks
 * @param {import("./work.js").Work} work @returns {AsyncGenerator<Run>}
 */
export async function* runs(vol, inode, blocks, work) {
  const each =
    inode.flags & FLAG_EXTENTS
      ? extentRuns(vol, inode.block, blocks, work, 0)
      : blockMapRuns(vol, inode.block, blocks, work);
  /** @type {Run | undefined} */
  let run;
  for await (const next of each) {
    if (
      run &&
      run.logical + run.count === next.logical &&
      run.physical + run.count === next.physical
    )
      run.count += next.count;
    else {
      if (run) yield run;
      run = { ...next };
    }
  }
  if (run) yield run;
}

/**
 * The first `want` bytes of a file, read run by run in chunks of at most 4 MiB.
 * @param {Volume} vol @param {Inode} inode @param {number} want
 * @param {import("./work.js").Work} work
 */
export async function readData(vol, inode, want, work) {
  const out = new Uint8Array(want);
  if (!want) return out;
  if (inode.flags & FLAG_INLINE) {
    const data = inlineData(inode);
    out.set(data.subarray(0, want));
    return out;
  }
  for await (const run of runs(vol, inode, Math.ceil(want / vol.bs), work)) {
    const from = run.logical * vol.bs;
    if (from >= want) break;
    const length = Math.min(run.count * vol.bs, want - from);
    for (let done = 0; done < length; ) {
      await work.tick();
      const n = Math.min(CHUNK, length - done);
      const bytes = await vol.source.read(run.physical * vol.bs + done, n);
      if (bytes.length < n)
        throw damaged(`A file's data goes past the end of the ${vol.type} volume.`);
      out.set(bytes, from + done);
      done += n;
    }
  }
  return out;
}

/**
 * A symbolic link's target: in i_block when shorter than 60 bytes (a fast link), otherwise in its
 * data or inline data.
 * @param {Volume} vol @param {Inode} inode @param {import("./work.js").Work} work
 */
export async function linkTarget(vol, inode, work) {
  const size = Math.min(inode.size, 65536);
  if (size < 60 && !(inode.flags & (FLAG_EXTENTS | FLAG_INLINE)))
    return text(inode.block.subarray(0, size));
  return text(await readData(vol, inode, size, work));
}
