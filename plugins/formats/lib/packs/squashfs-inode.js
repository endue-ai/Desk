// SquashFS 4.0 inodes and directory listings. An inode is a 16-byte header (type, mode, owner and
// group indexes, time, number) and a body by type: folders find their listing in the directory
// table, files their blocks and fragment, links their target. Basic and extended forms are read.
import { u16, u32, u64 } from "../disk/bytes.js";
import { damaged } from "./squashfs-meta.js";

/**
 * @typedef {{
 *   type: number, kind: "folder" | "file" | "link" | "device", mode: number, uid: number,
 *   gid: number, mtime: number, number: number, size: number,
 *   dirStart?: number, dirOffset?: number, listing?: number,
 *   blocksStart?: number, blocks?: number[], fragment?: number, fragmentOffset?: number,
 *   target?: string, device?: number,
 * }} Inode
 * `size` is a file's bytes (a folder's listing bytes, a link's target bytes); `blocks` the stored
 * size words of a file's blocks (bit 24 set: stored as it is; 0: a sparse block of zeros).
 * @typedef {{ name: string, ref: number, type: number, number: number }} DirEntry
 * `ref` is where the inode is: its block (from the inode table's start) times 65536 plus its offset.
 * @typedef {{ take(n: number): Promise<Uint8Array> }} Cursor
 */

const NONE = 0xffffffff;
const KINDS = /** @type {const} */ ([
  "",
  "folder",
  "file",
  "link",
  "device",
  "device",
  "device",
  "device",
]);

/**
 * The inode the cursor stands on.
 * @param {Cursor} c @param {number} blockSize @returns {Promise<Inode>}
 */
export async function readInode(c, blockSize) {
  const h = await c.take(16);
  const type = u16(h, 0);
  const basic = type > 7 ? type - 7 : type;
  if (type < 1 || type > 14) throw damaged(`an inode has the unknown type ${type}`);
  /** @type {Inode} */
  const inode = {
    type,
    kind: /** @type {Inode["kind"]} */ (KINDS[basic]),
    mode: u16(h, 2),
    uid: u16(h, 4),
    gid: u16(h, 6),
    mtime: u32(h, 8),
    number: u32(h, 12),
    size: 0,
  };
  if (type === 1) {
    const b = await c.take(16);
    inode.dirStart = u32(b, 0);
    inode.listing = Math.max(0, u16(b, 8) - 3);
    inode.dirOffset = u16(b, 10);
  } else if (type === 8) {
    const b = await c.take(24);
    inode.listing = Math.max(0, u32(b, 4) - 3);
    inode.dirStart = u32(b, 8);
    inode.dirOffset = u16(b, 18);
  } else if (type === 2 || type === 9) {
    const ext = type === 9;
    const b = await c.take(ext ? 40 : 16);
    inode.blocksStart = ext ? u64(b, 0) : u32(b, 0);
    inode.size = ext ? u64(b, 8) : u32(b, 12);
    inode.fragment = ext ? u32(b, 28) : u32(b, 4);
    inode.fragmentOffset = ext ? u32(b, 32) : u32(b, 8);
    const whole = inode.fragment === NONE;
    const count = whole ? Math.ceil(inode.size / blockSize) : Math.floor(inode.size / blockSize);
    if (count > 1 << 24) throw damaged("a file is larger than the file system can hold");
    const list = await c.take(count * 4);
    inode.blocks = Array.from({ length: count }, (_, i) => u32(list, i * 4));
  } else if (type === 3 || type === 10) {
    const b = await c.take(8);
    const length = u32(b, 4);
    if (length > 65536) throw damaged("a link's target is longer than a path can be");
    inode.target = new TextDecoder().decode(await c.take(length));
    inode.size = length;
  } else if (basic === 4 || basic === 5) {
    inode.device = u32(await c.take(8), 4);
  }
  return inode;
}

/** The size of a fixed header and entry of a listing. */
const HEADER = 12;
const ENTRY = 8;

/**
 * A folder's listing, read whole from the directory table: names with where their inodes are.
 * @param {Uint8Array} b the listing's bytes @returns {DirEntry[]}
 */
export function parseListing(b) {
  /** @type {DirEntry[]} */
  const entries = [];
  let o = 0;
  while (o < b.length) {
    if (o + HEADER > b.length) throw damaged("a folder's listing is cut short");
    const count = u32(b, o) + 1;
    const start = u32(b, o + 4);
    const base = u32(b, o + 8);
    o += HEADER;
    if (count > 256) throw damaged("a folder's listing has a run of more than 256 entries");
    for (let i = 0; i < count; i++) {
      if (o + ENTRY > b.length) throw damaged("a folder's listing is cut short");
      const offset = u16(b, o);
      const delta = (u16(b, o + 2) << 16) >> 16;
      const type = u16(b, o + 4);
      const length = u16(b, o + 6) + 1;
      o += ENTRY;
      if (o + length > b.length) throw damaged("a name in a folder's listing is cut short");
      const name = new TextDecoder().decode(b.subarray(o, o + length));
      o += length;
      if (type < 1 || type > 7) throw damaged(`“${name}” has the unknown type ${type}`);
      if (name.includes("/") || name === "." || name === "..")
        throw damaged(`a folder lists the name “${name}”`);
      entries.push({ name, ref: start * 65536 + offset, type, number: base + delta });
    }
  }
  return entries;
}
