// A plan node as every engine's reader makes it, and the work done on a whole tree: each node's
// own share of the whole (by time when the statement ran, else by cost) and the nodes where most of
// it goes; its own time; the nodes in order for drawing. Pure.

/**
 * @typedef {{
 *   sharedHit: number, sharedRead: number, sharedDirtied: number, sharedWritten: number,
 *   localHit: number, localRead: number, localDirtied: number, localWritten: number,
 *   tempRead: number, tempWritten: number,
 * }} Buffers
 *   Blocks, as PostgreSQL counts them; a node's include its children's.
 * @typedef {{ records: number, fpi: number, bytes: number }} Wal
 * @typedef {{ kind: "misestimate" | "filter" | "spill" | "loops" | "index-filter", level: "high" | "medium", text: string }} Mark
 * @typedef {{ name: string, relation: string, time: number | null, calls: number | null }} Trigger
 * @typedef {{
 *   planning: number | null, execution: number | null,
 *   buffers: Buffers | null, planningBuffers: Buffers | null, wal: Wal | null,
 *   triggers: Trigger[], settings: Record<string, string>,
 *   jit: { functions: number | null, time: number | null } | null,
 *   serialization: { time: number | null, bytes: number | null } | null,
 *   memory: { used: number | null, allocated: number | null } | null,
 *   raw: string,
 * }} Summary
 *   What the whole statement took, summed at the top of the plan; `raw` is the server's JSON.
 * @typedef {{
 *   label: string, kind: string, detail: string, cost: number | null, rows: number | null,
 *   actualRows: number | null, loops: number | null, time: number | null, ownTime: number | null,
 *   removed: number | null, misestimate: number | null, buffers: Buffers | null, wal: Wal | null,
 *   marks: Mark[], children: PlanNode[], self: number, share: number, hot: "high" | "medium" | "",
 *   summary?: Summary,
 * }} PlanNode
 *   `cost` and `time` include the children's, as the engines print them; `time` is in ms over all
 *   loops and `actualRows` the rows of all loops, while `rows` is the planner's estimate for one.
 *   `misestimate` is the actual rows of one loop over the estimate (above 1: more than estimated).
 *   `ownTime` is the node's time less its children's. Only a root carries `summary`.
 */

export const num = (/** @type {unknown} */ v) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** @returns {PlanNode} */
export function node(/** @type {Partial<PlanNode> & { label: string }} */ fields) {
  return {
    kind: fields.label,
    detail: "",
    cost: null,
    rows: null,
    actualRows: null,
    loops: null,
    time: null,
    ownTime: null,
    removed: null,
    misestimate: null,
    buffers: null,
    wal: null,
    marks: [],
    children: [],
    self: 0,
    share: 0,
    hot: "",
    ...fields,
  };
}

/**
 * Work out each node's own share of the whole (by time when the statement ran, else by cost) and
 * mark the nodes that take half of it (high) or a fifth (medium); a node's own time too.
 * @param {PlanNode} root
 */
export function annotate(root) {
  const measure = root.time !== null ? "time" : "cost";
  const whole = root[measure] ?? 0;
  const visit = (/** @type {PlanNode} */ n) => {
    const below = n.children.reduce((sum, child) => sum + (child[measure] ?? 0), 0);
    n.self = Math.max(0, (n[measure] ?? 0) - below);
    n.share = whole > 0 ? n.self / whole : 0;
    n.hot = n.share >= 0.5 ? "high" : n.share >= 0.2 ? "medium" : n.hot;
    if (n.time !== null) {
      const timed = n.children.reduce((sum, child) => sum + (child.time ?? 0), 0);
      n.ownTime = Math.max(0, n.time - timed);
    }
    n.children.forEach(visit);
  };
  visit(root);
  return root;
}

/** The nodes in order, each with its depth, for drawing. */
export function flatten(/** @type {PlanNode} */ root) {
  /** @type {{ node: PlanNode, depth: number }[]} */
  const out = [];
  const visit = (/** @type {PlanNode} */ n, /** @type {number} */ depth) => {
    out.push({ node: n, depth });
    for (const child of n.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return out;
}

/** A misestimate of ten times or more, either way, as a mark (none without both counts). */
export function missed(/** @type {PlanNode} */ n) {
  const ratio = n.misestimate;
  if (ratio === null || (ratio < 10 && ratio > 0.1)) return undefined;
  const times = ratio >= 1 ? ratio : 1 / ratio;
  const round = times >= 100 ? Math.round(times).toLocaleString() : times.toFixed(0);
  /** @type {Mark} */
  const mark = {
    kind: "misestimate",
    level: times >= 100 ? "high" : "medium",
    text: `${round}× ${ratio >= 1 ? "more" : "fewer"} rows than estimated`,
  };
  return mark;
}

/** The actual rows of one loop over the planner's estimate, both at least one. */
export function ratioOf(
  /** @type {number | null} */ estimate,
  /** @type {number | null} */ actual,
) {
  if (estimate === null || actual === null) return null;
  return Math.max(actual, 1) / Math.max(estimate, 1);
}
