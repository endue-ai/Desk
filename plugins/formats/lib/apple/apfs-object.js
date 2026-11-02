// APFS objects and B-trees, after Apple's "Apple File System Reference": every object starts with
// obj_phys_t (a Fletcher-64 checksum, its oid, xid, type and subtype); B-tree nodes
// (btree_node_phys_t) hold a table of contents, keys from the front and values from the back, with
// btree_info_t at the end of the root; object maps (omap_phys_t) turn a virtual oid and a
// transaction into a physical block.
import { u16, u32, u64 } from "../disk/bytes.js";
import { damaged } from "../disk/work.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/work.js").Work} Work */
/**
 * @typedef {{ key: Uint8Array, value: Uint8Array | undefined }} Record a key and its value
 * (undefined for a ghost)
 * @typedef {{ leaf: boolean, level: number, records: Record[] }} Node
 * @typedef {{ key: number, value: number }} Fixed the sizes of a fixed-size tree's keys and leaf
 * values (its index values are child oids)
 */

export const OBJ_PHYSICAL = 0x40000000;
export const TYPE_NX_SUPERBLOCK = 0x1;
export const TYPE_BTREE = 0x2;
export const TYPE_BTREE_NODE = 0x3;
export const TYPE_OMAP = 0xb;
export const TYPE_FS = 0xd;

const BTNODE_ROOT = 0x1;
const BTNODE_LEAF = 0x2;
const BTNODE_FIXED = 0x4;
const OMAP_DELETED = 0x1;
const M = 0xffffffff;

/** The container is damaged: one sentence. @param {string} why */
export const broken = (why) => damaged(`The APFS container is damaged: ${why}.`);

/** Whether a block's Fletcher-64 checksum (over all but its first eight bytes) holds. @param {Uint8Array} b */
export function checksumOk(b) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let sum1 = 0;
  let sum2 = 0;
  for (let i = 8; i + 4 <= b.length; i += 4) {
    sum1 += view.getUint32(i, true);
    if (sum1 >= M) sum1 -= M;
    sum2 += sum1;
    if (sum2 >= M) sum2 -= M;
  }
  const c1 = M - ((sum1 + sum2) % M);
  const c2 = M - ((sum1 + c1) % M);
  return u32(b, 0) === c1 && u32(b, 4) === c2;
}

/** The object's type without its storage flags. @param {Uint8Array} b */
export const objectType = (b) => u32(b, 24) & 0xffff;

/**
 * The object at a physical block, its checksum checked.
 * @param {Source} source @param {number} block @param {number} size the block size
 * @param {string} what what it is, for the sentence ("a B-tree node")
 * @param {number} [length] the object's size, when it is not one block
 */
export async function readObject(source, block, size, what, length = size) {
  if (!block || block * size + length > source.size)
    throw broken(`${what} lies outside the container`);
  const bytes = await source.read(block * size, length);
  if (bytes.length < length) throw broken(`${what} is cut short`);
  if (!checksumOk(bytes)) throw broken(`${what} fails its checksum`);
  return bytes;
}

/**
 * A B-tree node's records in order.
 * @param {Uint8Array} b @param {Fixed} [fixed] key and leaf value sizes of a fixed-size tree
 * @returns {Node}
 */
export function parseNode(b, fixed) {
  const type = objectType(b);
  if (type !== TYPE_BTREE && type !== TYPE_BTREE_NODE) throw broken("a B-tree node is not one");
  const flags = u16(b, 32);
  const level = u16(b, 34);
  const count = u32(b, 36);
  const leaf = !!(flags & BTNODE_LEAF);
  const tableAt = 56 + u16(b, 40);
  const keysAt = tableAt + u16(b, 42);
  const valuesEnd = b.length - (flags & BTNODE_ROOT ? 40 : 0);
  const isFixed = !!(flags & BTNODE_FIXED);
  if (isFixed && !fixed) throw broken("a B-tree node has fixed-size entries where none belong");
  if (keysAt > b.length || count > (keysAt - tableAt) / (isFixed ? 4 : 8))
    throw broken("a B-tree node's table of contents does not fit");
  /** @type {Record[]} */
  const records = [];
  for (let i = 0; i < count; i++) {
    let k;
    let kLength;
    let v;
    let vLength;
    if (isFixed && fixed) {
      k = u16(b, tableAt + 4 * i);
      v = u16(b, tableAt + 4 * i + 2);
      kLength = fixed.key;
      vLength = leaf ? fixed.value : 8;
    } else {
      k = u16(b, tableAt + 8 * i);
      kLength = u16(b, tableAt + 8 * i + 2);
      v = u16(b, tableAt + 8 * i + 4);
      vLength = u16(b, tableAt + 8 * i + 6);
    }
    const keyAt = keysAt + k;
    if (keyAt + kLength > valuesEnd) throw broken("a B-tree key lies outside its node");
    const key = b.subarray(keyAt, keyAt + kLength);
    if (v === 0xffff) {
      records.push({ key, value: undefined });
      continue;
    }
    const valueAt = valuesEnd - v;
    if (valueAt < keysAt || valueAt + vLength > valuesEnd)
      throw broken("a B-tree value lies outside its node");
    records.push({ key, value: b.subarray(valueAt, valueAt + vLength) });
  }
  return { leaf, level, records };
}

/** The B-tree's node size, from the btree_info_t at the end of its root. @param {Uint8Array} root */
export const nodeSize = (root) => u32(root, root.length - 40 + 4) || root.length;

/** Compare an omap key (oid, xid) with the wanted one. @param {Uint8Array} key @param {number} oid @param {number} xid */
const compare = (key, oid, xid) => u64(key, 0) - oid || u64(key, 8) - xid;

/**
 * An object map: virtual oids to physical blocks as of a transaction. Parsed nodes are kept, so
 * walking a file-system tree costs one omap descent per node, from memory.
 */
export class ObjectMap {
  /** @param {Source} source @param {number} blockSize @param {number} tree the omap tree's root block */
  constructor(source, blockSize, tree) {
    this.source = source;
    this.blockSize = blockSize;
    this.tree = tree;
    /** @type {Map<number, Node>} */
    this.nodes = new Map();
  }

  /** Open the omap_phys_t at `block`. @param {Source} source @param {number} blockSize @param {number} block @param {string} what */
  static async open(source, blockSize, block, what) {
    const b = await readObject(source, block, blockSize, what);
    if (objectType(b) !== TYPE_OMAP) throw broken(`${what} is not an object map`);
    return new ObjectMap(source, blockSize, u64(b, 48));
  }

  /** @param {number} block */
  async node(block) {
    let node = this.nodes.get(block);
    if (!node) {
      node = parseNode(await readObject(this.source, block, this.blockSize, "an object map node"), {
        key: 16,
        value: 16,
      });
      if (this.nodes.size > 4096) this.nodes.clear();
      this.nodes.set(block, node);
    }
    return node;
  }

  /**
   * The physical block of `oid` as of transaction `xid`, or undefined when it has none.
   * @param {number} oid @param {number} xid
   */
  async lookup(oid, xid) {
    let block = this.tree;
    for (let depth = 0; depth < 16; depth++) {
      const node = await this.node(block);
      let found = -1;
      let lo = 0;
      let hi = node.records.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (compare(node.records[mid]?.key ?? new Uint8Array(16), oid, xid) <= 0) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      const record = node.records[found];
      if (!record?.value) return undefined;
      if (node.leaf) {
        if (u64(record.key, 0) !== oid || u32(record.value, 0) & OMAP_DELETED) return undefined;
        return u64(record.value, 8);
      }
      block = u64(record.value, 0);
    }
    throw broken("an object map is too deep");
  }
}

/**
 * Every leaf record of a B-tree, in key order, node by node. `resolve` turns a child oid into a
 * block (an omap lookup for virtual trees); `visit` sees each leaf node's records.
 * @param {Source} source @param {number} root the root's block @param {number} blockSize
 * @param {(oid: number) => Promise<number | undefined>} resolve
 * @param {(records: Record[]) => void} visit @param {Work} work @param {Fixed} [fixed]
 */
export async function walkTree(source, root, blockSize, resolve, visit, work, fixed) {
  let first = await readObject(source, root, blockSize, "a B-tree root");
  const size = nodeSize(first);
  if (size !== blockSize) first = await readObject(source, root, blockSize, "a B-tree root", size);
  /** @type {{ node: Node, next: number }[]} */
  const stack = [{ node: parseNode(first, fixed), next: 0 }];
  while (stack.length) {
    const top = /** @type {{ node: Node, next: number }} */ (stack.at(-1));
    if (top.node.leaf) {
      visit(top.node.records);
      stack.pop();
      continue;
    }
    const record = top.node.records[top.next++];
    if (!record) {
      stack.pop();
      continue;
    }
    if (!record.value) continue;
    if (stack.length > 16) throw broken("a B-tree is too deep");
    const block = await resolve(u64(record.value, 0));
    if (block === undefined) throw broken("a B-tree node is missing from the object map");
    const bytes = await readObject(source, block, blockSize, "a B-tree node", size);
    const child = parseNode(bytes, fixed);
    if (child.level !== top.node.level - 1) throw broken("a B-tree node is at the wrong level");
    stack.push({ node: child, next: 0 });
    await work.tick();
  }
}
