// A plan as a flame (an icicle): where its time goes, or its cost when it did not run, as blocks a
// row per depth, each inside its parent and as wide as its total. Pure.

/**
 * @typedef {import("./node.js").PlanNode} PlanNode
 * @typedef {{ node: PlanNode, x: number, w: number, depth: number }} Block
 *   `x` and `w` are parts of the whole width, 0 to 1.
 */

/**
 * A plan as an icicle: the root spans the width, each node's width is its total (time when the
 * statement ran, else cost) inside its parent's, children left to right; children that add up to
 * more than their parent (parallel workers) are scaled into it. Empty when there is nothing to
 * measure (SQLite's plans).
 * @param {PlanNode} root
 */
export function flameOf(root) {
  const measure = root.time !== null ? "time" : "cost";
  const whole = root[measure] ?? 0;
  /** @type {Block[]} */
  const blocks = [];
  if (!(whole > 0)) return { measure, blocks, depth: 0 };
  const place = (
    /** @type {PlanNode} */ n,
    /** @type {number} */ x,
    /** @type {number} */ w,
    /** @type {number} */ depth,
  ) => {
    blocks.push({ node: n, x, w, depth });
    const totals = n.children.map((c) => Math.max(0, c[measure] ?? 0));
    const sum = totals.reduce((s, v) => s + v, 0);
    const span = Math.max(n[measure] ?? 0, sum);
    let at = x;
    n.children.forEach((child, i) => {
      const width = span > 0 ? ((totals[i] ?? 0) / span) * w : 0;
      place(child, at, width, depth + 1);
      at += width;
    });
  };
  place(root, 0, 1, 0);
  return { measure, blocks, depth: Math.max(...blocks.map((b) => b.depth)) + 1 };
}
