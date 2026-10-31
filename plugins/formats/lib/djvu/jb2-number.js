// JB2's multivalue extension to the Z'-coder (DjVu v3 specification, appendix 2, 11.2.2): an
// integer in [low, high] decoded as a walk down a binary tree, one adaptive context per node.

const MOST_NODES = 1 << 22;

/** The ranges phase 2 tests, in order: [0], [1, 2], [3, 6], ... [131071, 262142]. */
const RANGES = 18;

/**
 * One integer context: a tree of decision nodes, allocated as they are first reached. A node is
 * identified by the path of decisions that leads to it, predetermined decisions included.
 */
export class NumberContext {
  constructor() {
    this.reset();
  }

  /** Forget every node (a numcoder reset record). */
  reset() {
    this.contexts = new Uint8Array(256);
    this.children = new Int32Array(512);
    this.count = 1;
  }

  /** The child of `node` reached by decision `bit`, made on first use. @param {number} node @param {number} bit */
  child(node, bit) {
    const at = node * 2 + bit;
    let next = this.children[at];
    if (next) return next;
    next = this.count++;
    if (next >= this.contexts.length) {
      if (next >= MOST_NODES)
        throw new Error("The JB2 data is damaged: it uses too many number contexts.");
      const contexts = new Uint8Array(this.contexts.length * 2);
      contexts.set(this.contexts);
      this.contexts = contexts;
      const children = new Int32Array(this.children.length * 2);
      children.set(this.children);
      this.children = children;
    }
    this.children[at] = next;
    return next;
  }
}

/**
 * Decodes an integer in [low, high]. Phase 1 decides the sign (1: not negative), phase 2 finds
 * the range v = |n| (or |n| - 1 below zero) falls in (0: in this range, 1: try the next one),
 * phase 3 reads v's bits within the range, most significant first. Decisions [low, high] settle
 * are not decoded, but the walk still passes their node.
 * @param {import("./zp.js").ZPDecoder} zp @param {NumberContext} tree
 * @param {number} low @param {number} high
 */
export function decodeNumber(zp, tree, low, high) {
  if (low > high) throw new Error("The JB2 data is damaged: a number has no possible value.");
  let node = 0;
  let negative;
  if (low >= 0) negative = false;
  else if (high < 0) negative = true;
  else negative = !zp.decode(tree.contexts, node);
  node = tree.child(node, negative ? 0 : 1);
  const vlo = negative ? (high < 0 ? -high - 1 : 0) : Math.max(low, 0);
  const vhi = negative ? -low - 1 : high;

  let base = 0;
  let bits = 0;
  for (; ; bits++) {
    if (bits >= RANGES) throw new Error("The JB2 data is damaged: a number is out of range.");
    const last = base * 2;
    let decision;
    if (vhi <= last) decision = 0;
    else if (vlo > last) decision = 1;
    else decision = zp.decode(tree.contexts, node);
    node = tree.child(node, decision);
    if (decision === 0) break;
    base = last + 1;
  }

  let v = base;
  for (let size = 1 << bits; size > 1; ) {
    const half = size >> 1;
    let bit;
    if (vhi < v + half) bit = 0;
    else if (vlo >= v + half) bit = 1;
    else bit = zp.decode(tree.contexts, node);
    node = tree.child(node, bit);
    if (bit) v += half;
    size = half;
  }
  return negative ? -v - 1 : v;
}
