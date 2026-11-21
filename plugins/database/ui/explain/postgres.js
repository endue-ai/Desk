// PostgreSQL's EXPLAIN (FORMAT JSON) as a plan tree, on every server from 13 to 18: each node's
// estimate against its actual rows (loops multiplied out), its time and own time, the rows its
// filter removed, its buffers and WAL, and the marks that say why it is slow (marks.js); the
// statement's planning and execution time, buffers, WAL, triggers, settings, JIT, serialization
// and planner memory summed at the top. Pure: the plan worker runs it (worker.js).

import { marksOf } from "./marks.js";
import { annotate, missed, node, num, ratioOf } from "./node.js";

/**
 * @typedef {import("./node.js").PlanNode} PlanNode
 * @typedef {import("./node.js").Buffers} Buffers
 * @typedef {import("./node.js").Wal} Wal
 * @typedef {import("./node.js").Summary} Summary
 */

const CONDITIONS = [
  "Hash Cond",
  "Merge Cond",
  "Index Cond",
  "Recheck Cond",
  "Join Filter",
  "Filter",
  "One-Time Filter",
];
const BLOCKS = /** @type {const} */ ([
  ["sharedHit", "Shared Hit Blocks"],
  ["sharedRead", "Shared Read Blocks"],
  ["sharedDirtied", "Shared Dirtied Blocks"],
  ["sharedWritten", "Shared Written Blocks"],
  ["localHit", "Local Hit Blocks"],
  ["localRead", "Local Read Blocks"],
  ["localDirtied", "Local Dirtied Blocks"],
  ["localWritten", "Local Written Blocks"],
  ["tempRead", "Temp Read Blocks"],
  ["tempWritten", "Temp Written Blocks"],
]);

/** A node's (or the planning's) buffers, when the plan has them. @returns {Buffers | null} */
export function buffersOf(/** @type {any} */ p) {
  if (!p || !BLOCKS.some(([, key]) => key in p)) return null;
  return /** @type {Buffers} */ (
    Object.fromEntries(BLOCKS.map(([name, key]) => [name, num(p[key]) ?? 0]))
  );
}

/** @returns {Wal | null} */
function walOf(/** @type {any} */ p) {
  if (!p || !("WAL Records" in p)) return null;
  return {
    records: num(p["WAL Records"]) ?? 0,
    fpi: num(p["WAL FPI"]) ?? 0,
    bytes: num(p["WAL Bytes"]) ?? 0,
  };
}

/** The node's label: its type, the join's kind, what it reads and with which index. */
function labelOf(/** @type {any} */ p) {
  const on = p["Relation Name"]
    ? ` on ${p.Schema ? `${p.Schema}.` : ""}${p["Relation Name"]}${p.Alias && p.Alias !== p["Relation Name"] ? ` ${p.Alias}` : ""}`
    : p["CTE Name"]
      ? ` on ${p["CTE Name"]}`
      : p["Function Name"]
        ? ` on ${p["Function Name"]}`
        : "";
  const using = p["Index Name"] ? ` using ${p["Index Name"]}` : "";
  const join = p["Join Type"] && p["Join Type"] !== "Inner" ? ` (${p["Join Type"]})` : "";
  return `${typeOf(p)}${join}${on}${using}`;
}

/** The node's type as PostgreSQL's text format names it: HashAggregate, Update. */
const typeOf = (/** @type {any} */ p) =>
  p["Node Type"] === "Aggregate"
    ? ({ Hashed: "HashAggregate", Sorted: "GroupAggregate", Mixed: "MixedAggregate" }[
        /** @type {string} */ (p.Strategy)
      ] ?? "Aggregate")
    : p["Node Type"] === "ModifyTable" && p.Operation
      ? String(p.Operation)
      : String(p["Node Type"] ?? "Node");

/** The conditions and the facts worth a line: sort, hash, workers, output (VERBOSE). */
function detailOf(/** @type {any} */ p) {
  const lines = CONDITIONS.filter((k) => p[k]).map((k) => `${k}: ${p[k]}`);
  if (Array.isArray(p["Sort Key"])) lines.push(`Sort Key: ${p["Sort Key"].join(", ")}`);
  if (Array.isArray(p["Group Key"])) lines.push(`Group Key: ${p["Group Key"].join(", ")}`);
  if (p["Sort Method"])
    lines.push(
      `Sort Method: ${p["Sort Method"]}${p["Sort Space Used"] !== undefined ? ` (${p["Sort Space Type"] ?? ""} ${p["Sort Space Used"]} kB)` : ""}`,
    );
  if (p["Hash Batches"] !== undefined)
    lines.push(
      `Buckets: ${p["Hash Buckets"]} Batches: ${p["Hash Batches"]} Memory: ${p["Peak Memory Usage"] ?? "?"} kB`,
    );
  if (p["Workers Planned"] !== undefined)
    lines.push(`Workers: ${p["Workers Launched"] ?? "?"} of ${p["Workers Planned"]} planned`);
  if (Array.isArray(p.Output) && p.Output.length) lines.push(`Output: ${p.Output.join(", ")}`);
  return lines.join(" · ");
}

/** One node of the JSON plan and the nodes under it. @returns {PlanNode} */
function walk(/** @type {any} */ p) {
  const loops = num(p["Actual Loops"]);
  const per = num(p["Actual Total Time"]);
  const actual = num(p["Actual Rows"]);
  const times = loops ?? 1;
  const removed = num(p["Rows Removed by Filter"]);
  const made = node({
    label: labelOf(p),
    kind: String(p["Node Type"] ?? "Node"),
    detail: detailOf(p),
    cost: num(p["Total Cost"]),
    rows: num(p["Plan Rows"]),
    actualRows: actual === null ? null : actual * times,
    loops,
    time: per === null ? null : per * times,
    removed: removed === null ? null : removed * times,
    misestimate: loops === 0 ? null : ratioOf(num(p["Plan Rows"]), actual),
    buffers: buffersOf(p),
    wal: walOf(p),
    children: (p.Plans ?? []).map(walk),
  });
  // A write returns no rows unless it says RETURNING, whatever the planner counted.
  const miss = made.kind === "ModifyTable" ? undefined : missed(made);
  made.marks = [...(miss ? [miss] : []), ...marksOf(p, made)];
  return made;
}

/** The statement's totals: what EXPLAIN printed beside the plan. @returns {Summary} */
function summaryOf(
  /** @type {any} */ top,
  /** @type {PlanNode} */ root,
  /** @type {string} */ raw,
) {
  const planning = top?.Planning;
  const serialization = top?.Serialization;
  return {
    planning: num(top?.["Planning Time"]),
    execution: num(top?.["Execution Time"]),
    buffers: root.buffers,
    planningBuffers: buffersOf(planning),
    wal: root.wal,
    triggers: (top?.Triggers ?? []).map((/** @type {any} */ t) => ({
      name: String(t["Trigger Name"] ?? t["Constraint Name"] ?? "trigger"),
      relation: String(t.Relation ?? ""),
      time: num(t.Time),
      calls: num(t.Calls),
    })),
    settings: top?.Settings && typeof top.Settings === "object" ? top.Settings : {},
    jit: top?.JIT
      ? { functions: num(top.JIT.Functions), time: num(top.JIT.Timing?.Total ?? top.JIT.Timing) }
      : null,
    serialization: serialization
      ? { time: num(serialization.Time), bytes: num(serialization["Output Volume"]) }
      : null,
    memory:
      planning && "Memory Used" in planning
        ? { used: num(planning["Memory Used"]), allocated: num(planning["Memory Allocated"]) }
        : null,
    raw,
  };
}

/**
 * PostgreSQL's JSON plan: [{ "Plan": {...}, "Planning Time", "Execution Time", ... }].
 * @param {any} json
 * @param {string} [raw] The text the server printed, kept for a copy as JSON.
 */
export function postgresPlan(json, raw = "") {
  const top = Array.isArray(json) ? json[0] : json;
  const root = annotate(walk(top?.Plan ?? {}));
  root.summary = summaryOf(top, root, raw);
  return root;
}
