// Two plans of a statement compared node by node: the trees are walked together, a node's children
// paired by their type and relation, then by relation, then by position, and each pair says what changed:
// its kind, or its cost or time by a fifth or more; a node only one plan has is added or gone. Pure.

/**
 * @typedef {import("./node.js").PlanNode} PlanNode
 * @typedef {{ label: string, kind: string, cost: number | null, time: number | null, rows: number | null, actualRows: number | null, ownTime: number | null, hot: string }} Brief
 * @typedef {{ depth: number, before: Brief | null, after: Brief | null, changes: string[] }} Row
 * @typedef {{ rows: Row[], changed: number }} Comparison
 */

/** A change of a fifth or more, either way, is a change. */
const RATIO = 1.2;
/** Times closer than this many ms are the same. */
const NOISE_MS = 0.05;

/** @returns {Brief} */
const brief = (/** @type {PlanNode} */ n) => ({
  label: n.label,
  kind: n.kind,
  cost: n.cost,
  time: n.time,
  rows: n.rows,
  actualRows: n.actualRows,
  ownTime: n.ownTime,
  hot: n.hot,
});

const relationOf = (/** @type {PlanNode} */ n) => /\bon (\S+)/u.exec(n.label)?.[1] ?? "";
const keyOf = (/** @type {PlanNode} */ n) => `${n.kind}|${relationOf(n)}`;
const round = (/** @type {number} */ n) =>
  n >= 100 ? Math.round(n).toLocaleString() : String(Number(n.toFixed(2)));

/** "cost 30 → 12 (−60%)", when the change is large enough. */
function moved(
  /** @type {string} */ what,
  /** @type {number | null} */ a,
  /** @type {number | null} */ b,
  /** @type {string} */ unit,
) {
  if (a === null || b === null) return undefined;
  if (what === "time" && Math.abs(b - a) < NOISE_MS) return undefined;
  const ratio = a > 0 ? b / a : b > 0 ? Number.POSITIVE_INFINITY : 1;
  if (ratio < RATIO && ratio > 1 / RATIO) return undefined;
  const percent = Number.isFinite(ratio) ? Math.round((ratio - 1) * 100) : null;
  const by =
    percent === null ? "" : ` (${percent > 0 ? "+" : "−"}${Math.abs(percent).toLocaleString()}%)`;
  return `${what} ${round(a)}${unit} → ${round(b)}${unit}${by}`;
}

/** What changed from one node to its pair. */
function changesOf(/** @type {PlanNode | undefined} */ a, /** @type {PlanNode | undefined} */ b) {
  if (!a) return ["added"];
  if (!b) return ["gone"];
  const out = [];
  if (a.kind !== b.kind) out.push(`${a.kind} → ${b.kind}`);
  else if (a.label !== b.label) out.push(`now ${b.label}`);
  const cost = moved("cost", a.cost, b.cost, "");
  if (cost) out.push(cost);
  const time = moved("time", a.time, b.time, " ms");
  if (time) out.push(time);
  return out;
}

/**
 * Pair two lists of children: the same type on the same relation first, then the same relation
 * (a scan that changed its kind), then what is left by position.
 */
function pair(/** @type {PlanNode[]} */ as, /** @type {PlanNode[]} */ bs) {
  const used = new Set();
  /** @type {[PlanNode | undefined, PlanNode | undefined][]} */
  const pairs = as.map((a) => [a, undefined]);
  const pass = (/** @type {(a: PlanNode, b: PlanNode) => boolean} */ same) => {
    for (const p of pairs) {
      const a = p[0];
      if (p[1] || !a) continue;
      const at = bs.findIndex((b, i) => !used.has(i) && same(a, b));
      if (at < 0) continue;
      used.add(at);
      p[1] = bs[at];
    }
  };
  pass((a, b) => keyOf(a) === keyOf(b));
  pass((a, b) => relationOf(a) !== "" && relationOf(a) === relationOf(b));
  pass(() => true);
  bs.forEach((b, i) => {
    if (!used.has(i)) pairs.push([undefined, b]);
  });
  return pairs;
}

/** @returns {Comparison} */
export function comparePlans(/** @type {PlanNode} */ before, /** @type {PlanNode} */ after) {
  /** @type {Row[]} */
  const rows = [];
  const visit = (
    /** @type {PlanNode | undefined} */ a,
    /** @type {PlanNode | undefined} */ b,
    /** @type {number} */ depth,
  ) => {
    rows.push({
      depth,
      before: a ? brief(a) : null,
      after: b ? brief(b) : null,
      changes: changesOf(a, b),
    });
    for (const [x, y] of pair(a?.children ?? [], b?.children ?? [])) visit(x, y, depth + 1);
  };
  visit(before, after, 0);
  return { rows, changed: rows.filter((r) => r.changes.length > 0).length };
}
