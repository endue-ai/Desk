// ext2, ext3 and ext4, read only: the superblock (checked, with its CRC-32C when the volume keeps
// metadata checksums), the group descriptors (32 or 64 bytes, meta_bg placement), inodes, and the
// directory tree walked from the root. From the ext4 disk layout documentation.
import { ENCRYPTED, row } from "./archive.js";
import { crc32cRaw, formatSize, text, u16, u32 } from "./bytes.js";
import { readDirectory } from "./ext-dir.js";
import {
  FLAG_ENCRYPT,
  linkTarget,
  parseInode,
  readData,
  S_IFDIR,
  S_IFLNK,
  S_IFMT,
  S_IFREG,
} from "./ext-inode.js";
import { damaged } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./archive.js").FileEntry} FileEntry */
/** @typedef {import("./archive.js").FileSystem} FileSystem */
/** @typedef {import("./work.js").Work} Work */

const MAGIC = 0xef53;
const COMPAT_HAS_JOURNAL = 0x4;
const INCOMPAT = {
  compression: 0x1,
  fileType: 0x2,
  recover: 0x4,
  journalDev: 0x8,
  metaBg: 0x10,
  extents: 0x40,
  bits64: 0x80,
  mmp: 0x100,
  flexBg: 0x200,
  eaInode: 0x400,
  dirData: 0x1000,
  csumSeed: 0x2000,
  largeDir: 0x4000,
  inlineData: 0x8000,
  encrypt: 0x10000,
  casefold: 0x20000,
};
const RO_SPARSE_SUPER = 0x1;
const RO_METADATA_CSUM = 0x400;
/** Incompatible features of ext4 only, and read-only ones (huge_file, gdt_csum, dir_nlink, ...). */
const EXT4_INCOMPAT =
  0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x2000 | 0x4000 | 0x8000 | 0x10000 | 0x20000;
const EXT4_RO = 0x8 | 0x10 | 0x20 | 0x40 | 0x200 | 0x400 | 0x2000 | 0x8000;
const KNOWN_INCOMPAT = Object.values(INCOMPAT).reduce((all, bit) => all | bit, 0);

/** @param {number} compat @param {number} incompat @param {number} ro */
const typeOf = (compat, incompat, ro) =>
  incompat & EXT4_INCOMPAT || ro & EXT4_RO ? "ext4" : compat & COMPAT_HAS_JOURNAL ? "ext3" : "ext2";

/** Whether `n` is a power of `base` (1 included). @param {number} n @param {number} base */
const powerOf = (n, base) => {
  while (n > 1 && n % base === 0) n /= base;
  return n === 1;
};

/** @param {number} n */
const powerOfTwo = (n) => n > 0 && (n & (n - 1)) === 0;

/**
 * Open an ext2, ext3 or ext4 volume. Throws a sentence when its superblock is damaged or it uses
 * features that are not read here.
 * @param {Source} source @param {Work} work @returns {Promise<FileSystem>}
 */
export async function openExt(source, work) {
  await work.tick();
  const sb = await source.read(1024, 1024);
  if (sb.length < 1024 || u16(sb, 0x38) !== MAGIC)
    throw damaged("The ext superblock is missing or damaged.");
  const compat = u32(sb, 0x5c);
  const incompat = u32(sb, 0x60);
  const ro = u32(sb, 0x64);
  const type = typeOf(compat, incompat, ro);
  const bad = (/** @type {string} */ what) =>
    damaged(`The ${type} superblock is damaged: ${what}.`);
  if (ro & RO_METADATA_CSUM && crc32cRaw(sb.subarray(0, 0x3fc)) !== u32(sb, 0x3fc))
    throw bad("its checksum does not match");

  const logBlock = u32(sb, 0x18);
  if (logBlock > 6) throw bad("its block size is impossible");
  const bs = 1024 << logBlock;
  const bits64 = !!(incompat & INCOMPAT.bits64);
  const blocksCount = u32(sb, 0x04) + (bits64 ? u32(sb, 0x150) * 2 ** 32 : 0);
  const freeBlocks = u32(sb, 0x0c) + (bits64 ? u32(sb, 0x158) * 2 ** 32 : 0);
  const firstDataBlock = u32(sb, 0x14);
  const blocksPerGroup = u32(sb, 0x20);
  const inodesPerGroup = u32(sb, 0x28);
  const inodesCount = u32(sb, 0x00);
  const inodeSize = u32(sb, 0x4c) === 0 ? 128 : u16(sb, 0x58);
  const descSize = bits64 ? u16(sb, 0xfe) : 32;
  if (!blocksCount || firstDataBlock >= blocksCount || firstDataBlock > 1)
    throw bad("its block counts are impossible");
  if (!blocksPerGroup || !inodesPerGroup || inodesPerGroup > bs * 8)
    throw bad("its block groups are impossible");
  const groups = Math.ceil((blocksCount - firstDataBlock) / blocksPerGroup);
  if (!inodesCount || inodesCount > groups * inodesPerGroup)
    throw bad("its inode count is impossible");
  if (inodeSize < 128 || inodeSize > bs || !powerOfTwo(inodeSize))
    throw bad("its inode size is impossible");
  if (descSize < 32 || descSize > bs || !powerOfTwo(descSize) || (bits64 && descSize < 64))
    throw bad("its group descriptor size is impossible");

  if (incompat & INCOMPAT.journalDev)
    throw damaged(`This is an external ${type} journal, not a file system.`);
  if (incompat & INCOMPAT.compression)
    throw damaged(`The ${type} volume uses compression, which is not read here.`);
  if (incompat & INCOMPAT.dirData || incompat & ~KNOWN_INCOMPAT)
    throw damaged(`The ${type} volume uses features that are not read here.`);

  const vol = {
    source,
    type,
    bs,
    largeDir: !!(incompat & INCOMPAT.largeDir),
    fileType: !!(incompat & INCOMPAT.fileType),
  };
  const descPerBlock = bs / descSize;
  const firstMetaBg = incompat & INCOMPAT.metaBg ? u32(sb, 0x104) : Number.POSITIVE_INFINITY;
  const sparse = !!(ro & RO_SPARSE_SUPER);
  const backup = (/** @type {number} */ g) =>
    g === 0 || !sparse || g === 1 || powerOf(g, 3) || powerOf(g, 5) || powerOf(g, 7);
  /** Where group `g`'s descriptor is: the table after the superblock, or its meta group's first group. */
  const descriptorAt = (/** @type {number} */ g) => {
    const meta = Math.floor(g / descPerBlock);
    if (meta < firstMetaBg) return (firstDataBlock + 1) * bs + g * descSize;
    const first = meta * descPerBlock;
    const block = firstDataBlock + first * blocksPerGroup + (backup(first) ? 1 : 0);
    return block * bs + (g % descPerBlock) * descSize;
  };
  /** @type {Map<number, number>} */
  const tables = new Map();
  const inodeTable = async (/** @type {number} */ g) => {
    const known = tables.get(g);
    if (known !== undefined) return known;
    const desc = await source.read(descriptorAt(g), descSize);
    if (desc.length < descSize)
      throw damaged(`The ${type} group descriptors go past the volume's end.`);
    const table = u32(desc, 8) + (descSize >= 64 ? u32(desc, 0x28) * 2 ** 32 : 0);
    if (!table || table >= blocksCount) throw damaged(`The ${type} group descriptors are damaged.`);
    tables.set(g, table);
    return table;
  };
  const readInode = async (/** @type {number} */ ino) => {
    const g = Math.floor((ino - 1) / inodesPerGroup);
    const offset = (await inodeTable(g)) * bs + ((ino - 1) % inodesPerGroup) * inodeSize;
    const raw = await source.read(offset, inodeSize);
    if (raw.length < inodeSize)
      throw damaged(`An inode table goes past the end of the ${type} volume.`);
    return parseInode(vol, ino, raw);
  };

  const details = [row("Block size", formatSize(bs))];
  if (incompat & INCOMPAT.recover)
    details.push(
      row("Journal", "Holds changes that were never written back; the volume is read as it is."),
    );
  const label = text(sb.subarray(0x78, 0x88)).replace(/\0[\s\S]*$/, "");

  return {
    type,
    label,
    size: blocksCount * bs,
    used: Math.max(0, blocksCount - freeBlocks) * bs,
    details,
    list: async (work) => {
      const root = await readInode(2);
      if ((root.mode & S_IFMT) !== S_IFDIR) throw damaged(`The ${type} root folder is damaged.`);
      /** @type {FileEntry[]} */
      const entries = [];
      const folders = [{ inode: root, path: "" }];
      const seen = new Set([2]);
      for (let next = 0; next < folders.length; next++) {
        const { inode, path } = /** @type {(typeof folders)[number]} */ (folders[next]);
        await work.tick();
        for (const child of await readDirectory(vol, inode, work)) {
          await work.tick();
          if (child.ino < 1 || child.ino > inodesCount) continue;
          const node = await readInode(child.ino);
          const at = path ? `${path}/${child.name}` : child.name;
          const format = node.mode & S_IFMT;
          /** @type {FileEntry} */
          const entry = { path: at, kind: "file", size: 0, ref: child.ino };
          if (node.date) entry.date = node.date;
          const encrypted = !!(node.flags & FLAG_ENCRYPT);
          if (encrypted) Object.assign(entry, { encrypted: true, refusal: ENCRYPTED });
          if (format === S_IFDIR) {
            entry.kind = "folder";
            if (!encrypted && !seen.has(child.ino)) {
              seen.add(child.ino);
              folders.push({ inode: node, path: at });
            }
          } else if (format === S_IFLNK) {
            entry.kind = "link";
            entry.size = node.size;
            entry.link = encrypted ? "" : await linkTarget(vol, node, work);
          } else if (format === S_IFREG) entry.size = node.size;
          else entry.refusal ??= "A device, pipe or socket: nothing to extract.";
          entries.push(entry);
        }
      }
      return entries;
    },
    read: async (ref, limit, work) => {
      const inode = await readInode(/** @type {number} */ (ref));
      return readData(vol, inode, Math.min(limit, inode.size), work);
    },
  };
}
