// Small readers for the typed tree in assertions: a child by key path, and the kinds of children.
import { childrenOf, type DataNode, plainOf } from "../ui/tree.js";

/** The node at a path of keys (object members, array indexes, element names) below `node`. */
export function kid(node: DataNode, ...keys: Array<string | number>): DataNode {
  let at = node;
  for (const key of keys) {
    const next = childrenOf(at).find((child) => child.key === key);
    if (!next) throw new Error(`no child ${String(key)} under ${String(at.key ?? "the root")}`);
    at = next;
  }
  return at;
}

export const keysOf = (node: DataNode) => childrenOf(node).map((child) => child.key);
export const kindsOf = (node: DataNode) => childrenOf(node).map((child) => child.kind);
export const plain = (node: DataNode) => plainOf(node);
export const where = (node: DataNode) => ({ line: node.line, col: node.col });

/** A document's first root; a test fails here when there is none. */
export function rootOf(doc: { roots: DataNode[] } | undefined): DataNode {
  const root = doc?.roots[0];
  if (!root) throw new Error("the document has no root");
  return root;
}

/** The child at an index; a test fails here when there is none. */
export function nth(node: DataNode, index: number): DataNode {
  const child = childrenOf(node).at(index);
  if (!child) throw new Error(`no child ${index} under ${String(node.key ?? "the root")}`);
  return child;
}

/** A document's root at an index; a test fails here when there is none. */
export function nthRoot(doc: { roots: DataNode[] }, index: number): DataNode {
  const root = doc.roots.at(index);
  if (!root) throw new Error(`the document has no root ${index}`);
  return root;
}
