// The text tier's check (ADR 0071): after one value is spliced into a YAML or TOML file, the file
// must read as before except that value. Two trees are walked side by side: the same kinds, keys,
// tags, anchors and values everywhere, and the expected kind and value at the edited path.

import { childrenOf, isBranch } from "../tree.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 * @typedef {import("./scalars.js").Expected} Expected
 */

/** @param {unknown} a @param {unknown} b */
function sameValue(a, b) {
  if (a instanceof Uint8Array && b instanceof Uint8Array)
    return a.length === b.length && a.every((byte, i) => byte === b[i]);
  return a === b;
}

/**
 * Whether `after` reads as `before` but for the node at `path` (root index, then child indexes),
 * which reads as `expected`.
 * @param {DataDoc} before
 * @param {DataDoc} after
 * @param {number[]} path
 * @param {Expected} expected
 */
export function sameExcept(before, after, path, expected) {
  if (after.errors.length > 0 || before.roots.length !== after.roots.length) return false;
  /** @type {Array<[DataNode, DataNode, number]>} Pairs to compare, and how much of `path` they follow (-1: off it). */
  const pending = before.roots.map((root, i) => [
    root,
    /** @type {DataNode} */ (after.roots[i]),
    i === path[0] ? 1 : -1,
  ]);
  for (let pair = pending.pop(); pair; pair = pending.pop()) {
    const [a, b, depth] = pair;
    if (a.key !== b.key) return false;
    if (depth === path.length) {
      if (b.kind !== expected.kind || !sameValue(b.value, expected.value)) return false;
      continue;
    }
    if (a.kind !== b.kind || a.tag !== b.tag || a.anchor !== b.anchor || a.alias !== b.alias)
      return false;
    if (!isBranch(a)) {
      if (!sameValue(a.value, b.value)) return false;
      continue;
    }
    const left = childrenOf(a);
    const right = childrenOf(b);
    if (left.length !== right.length) return false;
    left.forEach((child, i) => {
      const next = depth >= 0 && path[depth] === i ? depth + 1 : -1;
      pending.push([child, /** @type {DataNode} */ (right[i]), next]);
    });
  }
  return true;
}
