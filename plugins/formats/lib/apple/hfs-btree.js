// HFS+ B-trees (TN1150): the catalog, extents-overflow and attributes files are trees of nodes of
// one size; node 0 is the header node (the root, the first and last leaf, the node size), leaves
// are linked in key order. Each node lists its records' offsets backwards from its end.
import { u16be, u32be } from "../disk/bytes.js";
import { damaged } from "../disk/work.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/work.js").Work} Work */
/**
 * @typedef {{ kind: number, height: number, next: number, records: Uint8Array[] }} Node `kind`
 * -1 leaf, 0 index, 1 header, 2 map.
 * @typedef {{ name: string, nodeSize: number, root: number, first: number, depth: number,
 *   total: number, node(index: number): Promise<Node> }} Tree
 */

/**
 * A B-tree file opened by its header node.
 * @param {Source} file the tree's fork @param {string} name "catalog", "extents", "attributes"
 * @returns {Promise<Tree>}
 */
export async function openTree(file, name) {
  const bad = (/** @type {string} */ why) => damaged(`The HFS+ ${name} file is damaged: ${why}.`);
  const head = await file.read(0, 512);
  if (head.length < 120 || head[8] !== 1) throw bad("its header node is missing");
  const nodeSize = u16be(head, 14 + 18);
  if (nodeSize < 512 || nodeSize > 32768 || nodeSize & (nodeSize - 1))
    throw bad("its node size is not a power of two");
  const total = u32be(head, 14 + 22);
  if (total * nodeSize > file.size + nodeSize) throw bad("it is shorter than its nodes");
  /** @param {number} index @returns {Promise<Node>} */
  const node = async (index) => {
    if (index >= total) throw bad(`node ${index} is past its end`);
    const b = await file.read(index * nodeSize, nodeSize);
    if (b.length < nodeSize) throw bad(`node ${index} is cut short`);
    const count = u16be(b, 10);
    if (count * 2 + 14 > nodeSize) throw bad(`node ${index} lists too many records`);
    /** @type {Uint8Array[]} */
    const records = [];
    for (let i = 0; i < count; i++) {
      const from = u16be(b, nodeSize - 2 * (i + 1));
      const to = u16be(b, nodeSize - 2 * (i + 2));
      if (from < 14 || to < from || to > nodeSize - 2 * (count + 1))
        throw bad(`a record of node ${index} lies outside it`);
      records.push(b.subarray(from, to));
    }
    const kind = (b[8] ?? 0) > 127 ? (b[8] ?? 0) - 256 : (b[8] ?? 0);
    return { kind, height: b[9] ?? 0, next: u32be(b, 0), records };
  };
  return {
    name,
    nodeSize,
    root: u32be(head, 14 + 2),
    first: u32be(head, 14 + 10),
    depth: u16be(head, 14),
    total,
    node,
  };
}

/**
 * Every leaf record in key order, following the leaves' links from the first one.
 * @param {Tree} tree @param {Work} work @returns {AsyncGenerator<Uint8Array>}
 */
export async function* leafRecords(tree, work) {
  const seen = new Set();
  for (let index = tree.first; index; ) {
    if (seen.has(index) || seen.size > tree.total)
      throw damaged(`The HFS+ ${tree.name} file is damaged: its leaves link in a loop.`);
    seen.add(index);
    await work.tick();
    const node = await tree.node(index);
    if (node.kind !== -1)
      throw damaged(`The HFS+ ${tree.name} file is damaged: node ${index} is not a leaf.`);
    yield* node.records;
    index = node.next;
  }
}

/** A record's key and the data after it (keys start with their 16-bit length). @param {Uint8Array} record */
export function split(record) {
  const length = u16be(record, 0);
  const at = 2 + length + (length & 1);
  return {
    key: record.subarray(2, 2 + length),
    data: record.subarray(Math.min(at, record.length)),
  };
}
