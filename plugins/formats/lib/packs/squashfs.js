// SquashFS 4.0 images (and Snaps, and the file system of an AppImage) opened as their files: the
// superblock, the id, fragment and export tables, then the inode and directory tables walked from
// the root. File data is read block by block only when asked for.
import { row } from "../disk/archive.js";
import { at, formatSize, sizeDetail, u16, u32, u64 } from "../disk/bytes.js";
import { lru } from "../disk/lru.js";
import { cachedSource } from "../disk/source.js";
import { Work } from "../disk/work.js";
import { blockDecoder, COMPRESSORS, describeOptions, LEGACY_LZMA } from "./squashfs-codec.js";
import { parseListing, readInode } from "./squashfs-inode.js";
import { damaged, Metadata } from "./squashfs-meta.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/archive.js").Archive} Archive */
/** @typedef {import("../disk/archive.js").Entry} Entry */
/** @typedef {import("../disk/archive.js").Detail} Detail */
/** @typedef {import("./squashfs-inode.js").Inode} Inode */
/** @typedef {{ signal?: AbortSignal, format?: string }} SquashfsOptions */

const NONE = 0xffffffff;
const UNCOMPRESSED = 0x1000000;
const DEVICES = "Devices, pipes and sockets hold no data.";
/** The most bytes read into one piece: a listing or a file read whole. */
const LARGEST = 2 ** 31 - 1;

/** An image of a kind not read here: its details and the sentence, nothing listed. */
const refused = (
  /** @type {string} */ format,
  /** @type {Detail[]} */ details,
  /** @type {string} */ sentence,
) =>
  /** @type {Archive} */ ({
    format,
    entries: [],
    details,
    note: sentence,
    refusal: sentence,
    read: () => Promise.reject(new Error(sentence)),
  });

/**
 * Open a SquashFS image as an Archive: `format` names it ("SquashFS", "Snap", "AppImage").
 * @param {Source} source @param {SquashfsOptions} [options] @returns {Promise<Archive>}
 */
export async function openSquashfs(source, options = {}) {
  const work = new Work(options.signal);
  await work.tick();
  const format = options.format ?? "SquashFS";
  const s = await source.read(0, 96);
  if (s.length < 96 || !at(s, 0, "hsqs")) {
    if (at(s, 0, "sqsh"))
      return refused(format, [], "Big-endian SquashFS images (version 3 and older) are not read.");
    throw new Error("This is not a SquashFS image: its superblock is missing.");
  }
  const sb = superblock(s);
  const details = [
    row("Compression", COMPRESSORS[sb.compression] ?? `Unknown (${sb.compression})`),
    row("Size", sizeDetail(sb.used)),
    row("Inodes", sb.inodes),
    row("Block size", formatSize(sb.blockSize)),
    row("Version", `${sb.major}.${sb.minor}`),
    row("Created", new Date(sb.mtime * 1000).toISOString().slice(0, 19).replace("T", " ")),
  ];
  if (sb.major !== 4)
    return refused(
      format,
      details,
      `SquashFS version ${sb.major}.${sb.minor} is not read; version 4.0 is.`,
    );
  if (sb.compression === 2) return refused(format, details, LEGACY_LZMA);
  const decoder = blockDecoder(sb.compression);
  if (!decoder)
    return refused(format, details, `SquashFS compression ${sb.compression} is not known.`);
  check(sb, source.size);
  const fs = new Metadata(cachedSource(source), decoder, sb.used);
  if (sb.flags & 0x400) {
    const { bytes } = await fs.block(96);
    const said = describeOptions(sb.compression, bytes);
    if (said) details.splice(1, 0, row("Compression options", said));
  }
  const ids = await fs.table(sb.idTable, sb.idCount, 4, "id table");
  const owners = new Set();
  for (let i = 0; i < Math.min(sb.idCount, 8); i++) owners.add(u32(await ids(i), 0));
  details.push(row("Owner ids", [...owners].join(", ")));
  if (sb.fragments) details.push(row("Fragments", sb.fragments));
  if (sb.exportTable < 2 ** 63) {
    await fs.table(sb.exportTable, sb.inodes, 8, "export table");
    details.push(row("Exportable", "Yes"));
  }
  if (sb.xattrTable < 2 ** 63) details.push(row("Extended attributes", "Yes"));
  await work.tick();

  /** @type {Entry[]} */
  const entries = [];
  /** @type {Map<string, { entry: Entry, inode: Inode }>} */
  const refs = new Map();
  await walk(fs, sb, work, (path, inode) => {
    const entry = toEntry(path, inode, sb.compression);
    entries.push(entry);
    refs.set(path, { entry, inode });
  });

  const fragments =
    sb.fragments > 0 ? await fs.table(sb.fragmentTable, sb.fragments, 16, "fragment table") : null;
  const data = new DataBlocks(source, decoder, sb, fragments);
  return {
    format,
    entries,
    details,
    read: async (entry, limit = Number.POSITIVE_INFINITY, readOptions = {}) => {
      const found = refs.get(entry.path);
      if (!found) throw new Error(`“${entry.path}” is not in this image.`);
      if (found.entry.refusal) throw new Error(found.entry.refusal);
      if (found.entry.kind === "folder") throw new Error(`“${entry.path}” is a folder.`);
      if (found.entry.kind === "link") return new TextEncoder().encode(found.entry.link ?? "");
      const reading = new Work(readOptions.signal);
      await reading.tick();
      return data.read(
        found.inode,
        Math.min(found.inode.size, Math.max(0, limit)),
        reading,
        entry.path,
      );
    },
  };
}

/** The superblock's fields. @param {Uint8Array} s */
function superblock(s) {
  return {
    inodes: u32(s, 4),
    mtime: u32(s, 8),
    blockSize: u32(s, 12),
    fragments: u32(s, 16),
    compression: u16(s, 20),
    blockLog: u16(s, 22),
    flags: u16(s, 24),
    idCount: u16(s, 26),
    major: u16(s, 28),
    minor: u16(s, 30),
    root: u64(s, 32),
    used: u64(s, 40),
    idTable: u64(s, 48),
    xattrTable: u64(s, 56),
    inodeTable: u64(s, 64),
    dirTable: u64(s, 72),
    fragmentTable: u64(s, 80),
    exportTable: u64(s, 88),
  };
}
/** @typedef {ReturnType<typeof superblock>} Superblock */

/** Whether the superblock holds together, against the file's size. @param {Superblock} sb @param {number} size */
function check(sb, size) {
  if (sb.blockSize < 4096 || sb.blockSize > 1 << 20 || 1 << sb.blockLog !== sb.blockSize)
    throw damaged("its block size is not a power of two from 4 KiB to 1 MiB");
  if (sb.used > size)
    throw new Error(
      `The SquashFS image is cut short: it uses ${sizeDetail(sb.used)}, but the file holds ${sizeDetail(size)}.`,
    );
  if (sb.idCount === 0) throw damaged("it has no id table");
  for (const start of [sb.inodeTable, sb.dirTable, sb.idTable])
    if (start < 96 || start >= sb.used) throw damaged("a table starts outside the file system");
  if (sb.inodeTable >= sb.dirTable)
    throw damaged("its inode table comes after its directory table");
  if (sb.fragments && (sb.fragmentTable < 96 || sb.fragmentTable >= sb.used))
    throw damaged("its fragment table starts outside the file system");
}

/**
 * Every inode under the root, folders before what they hold, with its path.
 * @param {Metadata} fs @param {Superblock} sb @param {Work} work
 * @param {(path: string, inode: Inode) => void} visit
 */
async function walk(fs, sb, work, visit) {
  const inodeAt = (/** @type {number} */ ref) =>
    readInode(
      fs.cursor(sb.inodeTable + Math.floor(ref / 65536), ref % 65536, "an inode"),
      sb.blockSize,
    );
  const root = await inodeAt(sb.root);
  if (root.kind !== "folder") throw damaged("its root is not a folder");
  const seen = new Set([sb.root]);
  /** @type {Array<{ path: string, inode: Inode }>} */
  const stack = [{ path: "", inode: root }];
  let count = 0;
  while (stack.length) {
    const { path, inode } = /** @type {{ path: string, inode: Inode }} */ (stack.pop());
    if ((inode.listing ?? 0) > LARGEST)
      throw damaged(
        `the folder “${path || "/"}” says its listing is larger than a file system holds`,
      );
    const listing = await fs.read(
      sb.dirTable + (inode.dirStart ?? 0),
      inode.dirOffset ?? 0,
      inode.listing ?? 0,
      "a folder's listing",
    );
    /** @type {Array<{ path: string, inode: Inode }>} */
    const folders = [];
    for (const child of parseListing(listing)) {
      const node = await inodeAt(child.ref);
      if (node.uid >= sb.idCount || node.gid >= sb.idCount)
        throw damaged(`“${child.name}” names an owner that is not in the id table`);
      const childPath = path ? `${path}/${child.name}` : child.name;
      visit(childPath, node);
      if (node.kind === "folder") {
        if (seen.has(child.ref)) throw damaged(`the folder “${childPath}” holds itself`);
        seen.add(child.ref);
        folders.push({ path: childPath, inode: node });
      }
      if (++count % 1024 === 0) await work.tick();
    }
    stack.push(...folders.reverse());
    await work.tick();
  }
}

/** @param {string} path @param {Inode} inode @param {number} compression @returns {Entry} */
function toEntry(path, inode, compression) {
  /** @type {Entry} */
  const entry = { path, kind: "file", size: 0, date: new Date(inode.mtime * 1000) };
  if (inode.kind === "folder") entry.kind = "folder";
  else if (inode.kind === "link") {
    entry.kind = "link";
    entry.link = inode.target ?? "";
    entry.size = inode.size;
  } else if (inode.kind === "device") entry.refusal = DEVICES;
  else {
    entry.size = inode.size;
    entry.method = COMPRESSORS[compression] ?? "";
    if (inode.fragment === NONE)
      entry.packed = (inode.blocks ?? []).reduce((n, b) => n + (b & (UNCOMPRESSED - 1)), 0);
  }
  return entry;
}

/** File data: whole blocks one after another, and the tail in a shared fragment block. */
class DataBlocks {
  /**
   * @param {Source} source @param {import("./squashfs-codec.js").BlockDecoder} decoder @param {Superblock} sb
   * @param {((index: number) => Promise<Uint8Array>) | null} fragments
   */
  constructor(source, decoder, sb, fragments) {
    this.source = source;
    this.decoder = decoder;
    this.sb = sb;
    this.fragments = fragments;
    /** @type {(key: string) => Promise<Uint8Array>} */
    this.fragment = lru(8, async (key) => {
      const [start, word] = key.split(":").map(Number);
      return this.block(
        /** @type {number} */ (start),
        /** @type {number} */ (word),
        0,
        "a fragment block",
      );
    });
  }

  /** One stored block, decoded. @param {number} start @param {number} word @param {number} expect @param {string} what */
  async block(start, word, expect, what) {
    const size = word & (UNCOMPRESSED - 1);
    if (start + size > this.sb.used) throw damaged(`${what} lies past the end of the file system`);
    const stored = await this.source.read(start, size);
    if (stored.length < size) throw damaged(`${what} is cut short`);
    const bytes = word & UNCOMPRESSED ? stored : await this.decoder(stored, this.sb.blockSize);
    if (bytes.length < expect)
      throw damaged(`${what} decodes to ${bytes.length} bytes, not ${expect}`);
    return bytes;
  }

  /** The first `n` bytes of a file. @param {Inode} inode @param {number} n @param {Work} work @param {string} path */
  async read(inode, n, work, path) {
    const { blockSize } = this.sb;
    const blocks = inode.blocks ?? [];
    const stored = blocks.reduce((sum, word) => sum + (word & (UNCOMPRESSED - 1)), 0);
    if ((inode.blocksStart ?? 0) + stored > this.sb.used)
      throw damaged(`the blocks of “${path}” lie past the end of the file system`);
    if (n > LARGEST) throw new Error(`“${path}” is too large to read in one piece.`);
    const out = new Uint8Array(n);
    let at = inode.blocksStart ?? 0;
    let done = 0;
    for (let i = 0; i < blocks.length && done < n; i++) {
      const word = /** @type {number} */ (blocks[i]);
      const expect = Math.min(blockSize, inode.size - i * blockSize);
      if (word !== 0) {
        const bytes = await this.block(at, word, expect, `a block of “${path}”`);
        out.set(bytes.subarray(0, Math.min(expect, n - done)), done);
      }
      at += word & (UNCOMPRESSED - 1);
      done += Math.min(expect, n - done);
      await work.tick();
    }
    if (done < n) {
      if (inode.fragment === NONE || !this.fragments)
        throw damaged(`“${path}” has no data for its last ${n - done} bytes`);
      const entry = await this.fragments(/** @type {number} */ (inode.fragment));
      const word = u32(entry, 8);
      const tail = inode.size - blocks.length * blockSize;
      const offset = inode.fragmentOffset ?? 0;
      const bytes = await this.fragment(`${u64(entry, 0)}:${word}`);
      if (offset + tail > bytes.length)
        throw damaged(`the tail of “${path}” lies past its fragment`);
      out.set(bytes.subarray(offset, offset + (n - done)), done);
    }
    return out;
  }
}
