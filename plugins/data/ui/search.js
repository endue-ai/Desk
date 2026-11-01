// Search over keys and values. It walks every node, building a lazy file's children without
// keeping them, and gives each match as the child indexes from its root, so the tree opens down to
// it. Masked values are never searched: a search cannot tell what a secret holds.

import { childrenOf, isBranch, textOf } from "./tree.js";

/**
 * @typedef {import("./tree.js").DataNode} DataNode
 * @typedef {import("./tree.js").DataDoc} DataDoc
 * @typedef {{ path: number[], field: "key" | "value" }} Match `path`: the root's index, then child indexes
 */

export const MAX_MATCHES = 1000;
const MAX_VISITS = 5_000_000;

/**
 * @param {DataDoc} doc
 * @param {string} query
 * @param {(chain: DataNode[]) => boolean} masked
 * @returns {{ matches: Match[], more: boolean }}
 */
export function search(doc, query, masked) {
  const needle = query.toLowerCase();
  /** @type {Match[]} */
  const matches = [];
  if (needle === "") return { matches, more: false };
  let visits = 0;
  let more = false;
  /** @type {DataNode[]} */
  const chain = [];
  /** @type {number[]} */
  const path = [];
  /** @returns {boolean} false to stop */
  const visit = (/** @type {DataNode} */ node) => {
    if (++visits > MAX_VISITS || matches.length >= MAX_MATCHES) {
      more = true;
      return false;
    }
    chain.push(node);
    const key = chain.length > 1 ? String(node.key ?? "") : "";
    if (key.toLowerCase().includes(needle)) matches.push({ path: [...path], field: "key" });
    else if (!isBranch(node) && !masked(chain) && textOf(node).toLowerCase().includes(needle))
      matches.push({ path: [...path], field: "value" });
    if (isBranch(node)) {
      const children = childrenOf(node, node.children !== undefined);
      for (let i = 0; i < children.length; i++) {
        path.push(i);
        const go = visit(/** @type {DataNode} */ (children[i]));
        path.pop();
        if (!go) {
          chain.pop();
          return false;
        }
      }
    }
    chain.pop();
    return true;
  };
  for (let i = 0; i < doc.roots.length; i++) {
    path.push(i);
    const go = visit(/** @type {DataNode} */ (doc.roots[i]));
    path.pop();
    if (!go) break;
  }
  return { matches, more };
}

/**
 * The chain of nodes a path names, building what it passes through.
 * @param {DataDoc} doc
 * @param {number[]} path
 */
export function chainOf(doc, path) {
  const [rootIndex, ...rest] = path;
  const root = doc.roots[rootIndex ?? 0];
  if (!root) return [];
  const chain = [root];
  for (const index of rest) {
    const next = childrenOf(/** @type {DataNode} */ (chain.at(-1)))[index];
    if (!next) break;
    chain.push(next);
  }
  return chain;
}
