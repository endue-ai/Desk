// An APFS volume's file-system tree, after Apple's "Apple File System Reference": inodes
// (j_inode_val_t with its extended fields, the data stream's size among them), directory entries
// (j_drec_hashed_key_t or j_drec_key_t), file extents (j_file_extent_*, or the file-extent tree of
// a sealed volume) and extended attributes (j_xattr_val_t: the symlink's target, decmpfs and the
// resource fork). One walk over the tree's leaves gathers them; the paths are built from the root
// folder (inode 2) down, and a file's bytes are read from its extents when asked for.
import { part } from "../disk/archive.js";
import { u16, u32, u64 } from "../disk/bytes.js";
import { extentSource } from "../disk/source.js";
import { broken } from "./apfs-object.js";
import {
  DECMPFS,
  decmpfsHeader,
  decmpfsMethod,
  decmpfsRead,
  decmpfsRefusal,
  RESOURCE_FORK,
} from "./decmpfs.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/work.js").Work} Work */
/** @typedef {import("../disk/archive.js").FileEntry} FileEntry */
/** @typedef {import("./apfs-object.js").Record} Record */
/**
 * @typedef {{ bytes?: Uint8Array, stream?: number, size: number }} Xattr embedded bytes, or the
 * object id and size of the data stream that holds them
 * @typedef {{ id: number, privateId: number, mtime: number, flags: number, mode: number,
 *   size: number, decmpfs?: Xattr, fork?: Xattr, symlink?: string }} Inode
 * @typedef {{ name: string, id: number }} Child
 */

const TYPE_INODE = 3;
const TYPE_XATTR = 4;
const TYPE_FILE_EXTENT = 8;
const TYPE_DIR_REC = 9;
const INO_EXT_TYPE_DSTREAM = 8;
const XATTR_DATA_STREAM = 0x1;
const XATTR_DATA_EMBEDDED = 0x2;
const UF_COMPRESSED = 0x20;
const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;
const ROOT = 2;
const SYMLINK = "com.apple.fs.symlink";
const PIECE = 4 * 1024 * 1024;

const utf8 = new TextDecoder("utf-8");
/** A name without its closing NUL. @param {Uint8Array} b */
const name = (b) => utf8.decode(b[b.length - 1] === 0 ? b.subarray(0, -1) : b);
/** A 60-bit object id from a j_key_t. @param {Uint8Array} k @param {number} o */
const objectId = (k, o) => u32(k, o) + (u32(k, o + 4) & 0x0fffffff) * 0x100000000;
/** Nanoseconds since 1970 as milliseconds. @param {Uint8Array} b @param {number} o */
const time = (b, o) => (u32(b, o + 4) * 0x100000000 + u32(b, o)) / 1e6;

/** The data stream's size from an inode's extended fields, 0 when it has none. @param {Uint8Array} v */
function streamSize(v) {
  if (v.length < 96) return 0;
  const count = u16(v, 92);
  let data = 96 + 4 * count;
  for (let i = 0; i < count; i++) {
    const type = v[96 + 4 * i] ?? 0;
    const size = u16(v, 96 + 4 * i + 2);
    if (type === INO_EXT_TYPE_DSTREAM && data + 8 <= v.length) return u64(v, data);
    data += (size + 7) & ~7;
  }
  return 0;
}

/** An xattr's value: its embedded bytes or its stream. @param {Uint8Array} v @returns {Xattr | undefined} */
function xattr(v) {
  const flags = u16(v, 0);
  const length = u16(v, 2);
  if (flags & XATTR_DATA_EMBEDDED) {
    const bytes = v.slice(4, 4 + length);
    return { bytes, size: bytes.length };
  }
  if (flags & XATTR_DATA_STREAM && v.length >= 20) return { stream: u64(v, 4), size: u64(v, 12) };
  return undefined;
}

export class ApfsTree {
  /**
   * @param {Source} source the container @param {number} blockSize
   * @param {boolean} hashed whether directory entries have hashed keys
   */
  constructor(source, blockSize, hashed) {
    this.source = source;
    this.blockSize = blockSize;
    this.hashed = hashed;
    /** @type {Map<number, Inode>} */
    this.inodes = new Map();
    /** @type {Map<number, Child[]>} */
    this.children = new Map();
    /** @type {Map<number, number[]>} logical, length, block, ... per stream */
    this.extents = new Map();
  }

  /** Take in one leaf node of the file-system tree. @param {Record[]} records */
  visit(records) {
    for (const { key, value } of records) {
      if (!value || key.length < 8) continue;
      const id = objectId(key, 0);
      const type = (key[7] ?? 0) >> 4;
      if (type === TYPE_INODE) this.inode(id, value);
      else if (type === TYPE_DIR_REC) this.entry(id, key, value);
      else if (type === TYPE_FILE_EXTENT) {
        if (value.length < 16) throw broken("a file extent is cut short");
        const length = u32(value, 0) + (u32(value, 4) & 0xffffff) * 0x100000000;
        this.extent(id, u64(key, 8), length, u64(value, 8));
      } else if (type === TYPE_XATTR) this.attribute(id, key, value);
    }
  }

  /** @param {number} id @param {Uint8Array} v */
  inode(id, v) {
    if (v.length < 92) throw broken("an inode is cut short");
    const size = streamSize(v);
    if (!Number.isSafeInteger(size)) throw broken("an inode's size is out of range");
    const old = this.inodes.get(id);
    this.inodes.set(id, {
      ...old,
      id,
      privateId: u64(v, 8),
      mtime: time(v, 24),
      flags: u32(v, 68),
      mode: u16(v, 80),
      size,
    });
  }

  /** @param {number} parent @param {Uint8Array} k @param {Uint8Array} v */
  entry(parent, k, v) {
    const hashedLength = (u32(k, 8) & 0x3ff) + 12;
    const plainLength = u16(k, 8) + 10;
    const hashed = this.hashed
      ? k.length === hashedLength || k.length !== plainLength
      : k.length === hashedLength && k.length !== plainLength;
    const raw = hashed ? k.subarray(12, hashedLength) : k.subarray(10, plainLength);
    if (v.length < 8) throw broken("a folder entry is cut short");
    const list = this.children.get(parent);
    const child = { name: part(name(raw).normalize("NFC")), id: u64(v, 0) };
    if (list) list.push(child);
    else this.children.set(parent, [child]);
  }

  /** @param {number} id @param {number} logical @param {number} length @param {number} block */
  extent(id, logical, length, block) {
    const list = this.extents.get(id);
    if (list) list.push(logical, length, block);
    else this.extents.set(id, [logical, length, block]);
  }

  /** @param {number} id @param {Uint8Array} k @param {Uint8Array} v */
  attribute(id, k, v) {
    const which = name(k.subarray(10, 10 + u16(k, 8)));
    if (which !== DECMPFS && which !== RESOURCE_FORK && which !== SYMLINK) return;
    const value = xattr(v);
    if (!value) return;
    const inode =
      this.inodes.get(id) ??
      /** @type {Inode} */ ({ id, privateId: id, mtime: 0, flags: 0, mode: 0, size: 0 });
    this.inodes.set(id, inode);
    if (which === DECMPFS) inode.decmpfs = value;
    else if (which === RESOURCE_FORK) inode.fork = value;
    else if (value.bytes) inode.symlink = name(value.bytes);
  }

  /** A data stream's bytes as a Source of `size` bytes: its extents, zeros in holes. @param {number} id @param {number} size */
  stream(id, size) {
    const list = this.extents.get(id) ?? [];
    const count = list.length / 3;
    const block = this.blockSize;
    return extentSource(
      this.source,
      size,
      async (pos) => {
        let lo = 0;
        let hi = count - 1;
        let found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if ((list[mid * 3] ?? 0) <= pos) {
            found = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        const start = found < 0 ? 0 : (list[found * 3] ?? 0);
        const length = found < 0 ? 0 : (list[found * 3 + 1] ?? 0);
        if (found >= 0 && pos < start + length) {
          const at = list[found * 3 + 2] ?? 0;
          if (at) return { length: start + length - pos, at: at * block + pos - start };
          return { length: start + length - pos };
        }
        const next = found + 1 < count ? (list[(found + 1) * 3] ?? size) : size;
        return { length: Math.max(1, next - pos) };
      },
      "APFS volume",
    );
  }

  /** An xattr's bytes, read from its stream when it has one. @param {Xattr} value */
  async bytes(value) {
    if (value.bytes) return value.bytes;
    return this.stream(value.stream ?? 0, value.size).read(0, value.size);
  }

  /**
   * Every file, folder and link from the root down.
   * @param {Work} work @returns {Promise<FileEntry[]>}
   */
  async list(work) {
    /** @type {FileEntry[]} */
    const entries = [];
    const seen = new Set([ROOT]);
    /** @type {{ id: number, path: string }[]} */
    const folders = [{ id: ROOT, path: "" }];
    while (folders.length) {
      const folder = /** @type {{ id: number, path: string }} */ (folders.pop());
      for (const child of this.children.get(folder.id) ?? []) {
        const inode = this.inodes.get(child.id);
        if (!inode) throw broken(`“${child.name}” has no inode`);
        const path = folder.path ? `${folder.path}/${child.name}` : child.name;
        const date = new Date(inode.mtime);
        const kind = inode.mode & S_IFMT;
        if (kind === S_IFDIR) {
          entries.push({ path, kind: "folder", size: 0, date, ref: inode });
          if (!seen.has(child.id)) {
            seen.add(child.id);
            folders.push({ id: child.id, path });
          }
        } else if (kind === S_IFLNK) {
          const link = inode.symlink ?? "";
          const size = new TextEncoder().encode(link).length;
          entries.push({ path, kind: "link", size, date, link, ref: inode });
        } else entries.push(await this.file(path, date, inode));
        if (entries.length % 1024 === 0) await work.tick();
      }
    }
    return entries;
  }

  /** A file's entry: its size, or its decmpfs header's. @param {string} path @param {Date} date @param {Inode} inode @returns {Promise<FileEntry>} */
  async file(path, date, inode) {
    if ((inode.mode & S_IFMT) !== S_IFREG) {
      const refusal = `“${path}” is a device or pipe, which holds no data to read.`;
      return { path, kind: "file", size: 0, date, refusal, ref: inode };
    }
    if (!(inode.flags & UF_COMPRESSED) || !inode.decmpfs)
      return { path, kind: "file", size: inode.size, date, ref: inode };
    const attr =
      inode.decmpfs.bytes ?? (await this.stream(inode.decmpfs.stream ?? 0, 16).read(0, 16));
    const header = decmpfsHeader(attr);
    if (!header) throw broken(`“${path}” has a damaged compression header`);
    /** @type {FileEntry} */
    const entry = {
      path,
      kind: "file",
      size: header.size,
      date,
      method: decmpfsMethod(header),
      ref: inode,
    };
    entry.packed = inode.fork ? inode.fork.size : inode.decmpfs.size;
    const refusal = decmpfsRefusal(header);
    if (refusal) entry.refusal = refusal;
    return entry;
  }

  /**
   * The first `limit` bytes of a file.
   * @param {unknown} ref @param {number} limit @param {Work} work
   */
  async read(ref, limit, work) {
    const inode = /** @type {Inode} */ (ref);
    if (inode.flags & UF_COMPRESSED && inode.decmpfs) {
      const attr = await this.bytes(inode.decmpfs);
      const fork = inode.fork?.stream ? this.stream(inode.fork.stream, inode.fork.size) : undefined;
      const embedded = inode.fork?.bytes;
      /** @type {Source | undefined} */
      const source = embedded
        ? { size: embedded.length, read: async (o, n) => embedded.subarray(o, o + n) }
        : fork;
      return decmpfsRead(attr, source, limit, work);
    }
    await work.tick();
    const size = Math.min(limit, inode.size);
    if (size > 0x7fffffff) throw new Error("The file is too large to read at once.");
    const stream = this.stream(inode.privateId, inode.size);
    if (size <= PIECE) return stream.read(0, size);
    // A large file in pieces, so a cancel stops it between them.
    const out = new Uint8Array(size);
    for (let pos = 0; pos < size; pos += PIECE) {
      out.set(await stream.read(pos, Math.min(PIECE, size - pos)), pos);
      await work.tick();
    }
    return out;
  }
}
