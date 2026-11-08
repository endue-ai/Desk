// A WIM image's metadata resource: its security data, then a tree of directory entries from the
// root, each folder's children in one list that ends with a zero length. An entry names its file
// and the SHA-1 of its data; alternate stream entries follow it, the unnamed one holding the data.

import { part } from "../disk/archive.js";
import { fileTime, u16, u32, u64, utf16le } from "../disk/bytes.js";

/** @typedef {import("../disk/work.js").Work} Work */
/**
 * @typedef {{ path: string, kind: "file" | "folder" | "link", hash: string, tag: number,
 *   attributes: number, date?: Date }} Node
 * `hash` is the SHA-1 (hex) of the file's data, or of a link's reparse data; "" when it has none.
 */

export const DIRECTORY = 0x10;
export const REPARSE = 0x400;
export const SYMLINK = 0xa000000c;
export const JUNCTION = 0xa0000003;
const FIXED = 0x66;
const align8 = (/** @type {number} */ n) => Math.ceil(n / 8) * 8;

const HEX = Array.from({ length: 256 }, (_, v) => v.toString(16).padStart(2, "0"));

/** The SHA-1 at `o` as hex, "" when it is all zeros. @param {Uint8Array} b @param {number} o */
export function hashAt(b, o) {
  let hex = "";
  let any = 0;
  for (let i = 0; i < 20; i++) {
    const v = b[o + i] ?? 0;
    any |= v;
    hex += HEX[v];
  }
  return any ? hex : "";
}

/**
 * The image's files, folders and links, each folder before what it holds.
 * @param {Uint8Array} buf the decoded metadata resource @param {number} image its index, for errors
 * @param {Work} work @returns {Promise<Node[]>}
 */
export async function parseMetadata(buf, image, work) {
  const damaged = (/** @type {string} */ why) =>
    new Error(`The WIM metadata of image ${image} is damaged: ${why}.`);
  if (buf.length < 8) throw damaged("it is shorter than its security data");
  const security = Math.max(8, u32(buf, 0));
  const root = align8(security);
  /** @param {number} o */
  const dentry = (o) => {
    if (o + 8 > buf.length) throw damaged("a directory entry goes past its end");
    const length = u64(buf, o);
    if (length === 0) return undefined;
    if (length < FIXED || o + length > buf.length)
      throw damaged("a directory entry has an impossible length");
    const nameBytes = u16(buf, o + 0x64);
    if (FIXED + nameBytes > length) throw damaged("a file name runs past its entry");
    const attributes = u32(buf, o + 8);
    let unnamed = "";
    let next = o + align8(length);
    for (let k = u16(buf, o + 0x60); k > 0; k--) {
      if (next + 38 > buf.length) throw damaged("a stream entry goes past its end");
      const size = u64(buf, next);
      if (size < 38 || next + size > buf.length)
        throw damaged("a stream entry has an impossible length");
      if (u16(buf, next + 36) === 0 && !unnamed) unnamed = hashAt(buf, next + 16);
      next += align8(size);
    }
    return {
      name: utf16le(buf.subarray(o + FIXED, o + FIXED + nameBytes)),
      attributes,
      subdir: u64(buf, o + 0x10),
      date: fileTime(buf, o + 0x38),
      hash: hashAt(buf, o + 0x40),
      unnamed,
      tag: attributes & REPARSE ? u32(buf, o + 0x58) : 0,
      next,
    };
  };
  const top = dentry(root);
  if (!top) throw damaged("it has no root folder");
  /** @type {Node[]} */
  const nodes = [];
  const seen = new Set([root]);
  /** @type {{ at: number, path: string, depth: number }[]} */
  const stack =
    top.subdir && top.attributes & DIRECTORY ? [{ at: top.subdir, path: "", depth: 0 }] : [];
  while (stack.length) {
    const { at, path, depth } = /** @type {{ at: number, path: string, depth: number }} */ (
      stack.pop()
    );
    if (seen.has(at)) throw damaged("a folder contains itself");
    if (depth > 1024) throw damaged("its folders nest too deep");
    seen.add(at);
    /** @type {{ at: number, path: string, depth: number }[]} */
    const folders = [];
    for (let o = at, d = dentry(o); d; o = d.next, d = dentry(o)) {
      const name = part(d.name) || "_";
      const full = path ? `${path}/${name}` : name;
      const link = !!(d.attributes & REPARSE) && (d.tag === SYMLINK || d.tag === JUNCTION);
      const folder = !link && !!(d.attributes & DIRECTORY);
      /** @type {Node["kind"]} */
      const kind = link ? "link" : folder ? "folder" : "file";
      let hash = d.unnamed || d.hash;
      if (link) hash = d.hash || d.unnamed;
      else if (d.attributes & REPARSE) hash = d.unnamed;
      nodes.push({
        path: full,
        kind,
        hash: folder ? "" : hash,
        tag: d.tag,
        attributes: d.attributes,
        date: d.date,
      });
      if (folder && d.subdir) folders.push({ at: d.subdir, path: full, depth: depth + 1 });
      if (nodes.length % 2048 === 0) await work.tick();
    }
    // Children are listed right after their folder: walk the folders found here first to last.
    for (let i = folders.length - 1; i >= 0; i--) stack.push(/** @type {any} */ (folders[i]));
  }
  return nodes;
}

/**
 * A symbolic link's or junction's target from its reparse data (the reparse buffer after its tag
 * and length): the print name, else the substitute name; a relative link's "\" become "/".
 * @param {number} tag @param {Uint8Array} data
 */
export function linkTarget(tag, data) {
  const base = tag === SYMLINK ? 12 : 8;
  if (data.length < base) return "";
  const name = (/** @type {number} */ offset, /** @type {number} */ length) =>
    base + offset + length <= data.length
      ? utf16le(data.subarray(base + offset, base + offset + length))
      : "";
  let target = name(u16(data, 4), u16(data, 6)) || name(u16(data, 0), u16(data, 2));
  target = target.replace(/^\\\?\?\\/, "");
  if (tag === SYMLINK && u32(data, 8) & 1) target = target.replace(/\\/g, "/");
  return target;
}
