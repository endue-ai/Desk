// A plan to copy: as text in PostgreSQL's layout (each node with its cost and estimate, what it took
// per loop, its conditions under it, the statement's totals at the end), and as JSON (the server's
// own when it gave JSON, else the tree). Pure.

import { flatten } from "./node.js";

/** @typedef {import("./node.js").PlanNode} PlanNode */

const fixed = (/** @type {number} */ n) => (Number.isInteger(n) ? String(n) : n.toFixed(3));
const two = (/** @type {number} */ n) => n.toFixed(2);

/** One node's line, as `Seq Scan on t  (cost=… rows=…) (actual time=… rows=… loops=…)`. */
function line(/** @type {PlanNode} */ n) {
  const estimate =
    n.cost !== null || n.rows !== null
      ? `  (${[n.cost !== null ? `cost=${two(n.cost)}` : "", n.rows !== null ? `rows=${fixed(n.rows)}` : ""].filter(Boolean).join(" ")})`
      : "";
  const loops = n.loops ?? 1;
  const ran =
    n.loops === 0
      ? " (never executed)"
      : n.actualRows !== null
        ? ` (actual ${n.time !== null ? `time=${fixed(n.time / loops)} ` : ""}rows=${fixed(n.actualRows / loops)} loops=${loops})`
        : "";
  return `${n.label}${estimate}${ran}`;
}

/** The plan as text, in PostgreSQL's layout. */
export function planText(/** @type {PlanNode} */ root) {
  const out = [];
  for (const { node, depth } of flatten(root)) {
    const head = depth === 0 ? "" : `${" ".repeat(6 * depth - 4)}->  `;
    out.push(`${head}${line(node)}`);
    const under = " ".repeat(depth === 0 ? 2 : 6 * depth + 2);
    for (const part of node.detail ? node.detail.split(" · ") : []) out.push(`${under}${part}`);
  }
  const s = root.summary;
  if (s) {
    for (const t of s.triggers)
      out.push(
        `Trigger ${t.name}${t.relation ? ` on ${t.relation}` : ""}: time=${t.time ?? "?"} calls=${t.calls ?? "?"}`,
      );
    if (s.planning !== null) out.push(`Planning Time: ${s.planning.toFixed(3)} ms`);
    if (s.execution !== null) out.push(`Execution Time: ${s.execution.toFixed(3)} ms`);
  }
  return out.join("\n");
}

/** The tree without what the view works out, for a plan the server gave no JSON of. */
function bare(/** @type {PlanNode} */ n) {
  /** @type {Record<string, unknown>} */
  const out = { label: n.label };
  for (const key of /** @type {const} */ ([
    "detail",
    "cost",
    "rows",
    "actualRows",
    "loops",
    "time",
  ]))
    if (n[key] !== null && n[key] !== "") out[key] = n[key];
  if (n.children.length) out.children = n.children.map(bare);
  return out;
}

/** The plan as JSON: the server's as it printed it (laid out already), or the tree's. */
export function planJson(/** @type {PlanNode} */ root) {
  return root.summary?.raw || JSON.stringify(bare(root), null, 2);
}
