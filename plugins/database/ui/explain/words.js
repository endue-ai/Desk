// A plan's numbers in words, for the views (view-plan*.js) and the compare panel: times, counts,
// a node's rows against its estimate, its buffers, and the statement's totals. Pure.

/**
 * @typedef {import("./node.js").PlanNode} PlanNode
 * @typedef {import("./node.js").Buffers} Buffers
 * @typedef {import("./node.js").Summary} Summary
 */

const fixed = (/** @type {number} */ n, /** @type {number} */ digits) =>
  Number(n.toFixed(digits)).toLocaleString();

/** A count, rounded. */
export const count = (/** @type {number} */ n) => Math.round(n).toLocaleString();

/** Milliseconds, with fewer digits as they grow. */
export const ms = (/** @type {number} */ n) =>
  `${n >= 100 ? count(n) : n >= 10 ? fixed(n, 1) : fixed(n, 2)} ms`;

/** A cost as the planner prints it. */
export const costText = (/** @type {number} */ n) => (n >= 100 ? count(n) : fixed(n, 2));

/** "est. 2 × 666 loops → 1,980 rows", "est. 120 rows", or "1,980 rows". */
export function rowsText(/** @type {PlanNode} */ n) {
  if (n.loops === 0)
    return n.rows !== null ? `est. ${count(n.rows)} rows · never ran` : "never ran";
  const looped = n.loops !== null && n.loops > 1 ? ` × ${count(n.loops)} loops` : "";
  const estimate = n.rows !== null ? `est. ${count(n.rows)}${looped}` : "";
  if (n.actualRows === null) return estimate ? `${estimate} rows` : "";
  return `${estimate ? `${estimate} → ` : ""}${count(n.actualRows)} rows`;
}

/** "own 1.2 ms of 4.5 ms", when the statement ran with TIMING. */
export function timeText(/** @type {PlanNode} */ n) {
  if (n.time === null) return "";
  return n.children.length && n.ownTime !== null
    ? `own ${ms(n.ownTime)} of ${ms(n.time)}`
    : ms(n.time);
}

/** "hit 1,204 · read 33 · temp written 155", the counts that are not zero. */
export function buffersText(/** @type {Buffers | null} */ b) {
  if (!b) return "";
  const parts = [
    ["hit", b.sharedHit],
    ["read", b.sharedRead],
    ["dirtied", b.sharedDirtied],
    ["written", b.sharedWritten],
    ["local hit", b.localHit],
    ["local read", b.localRead],
    ["temp read", b.tempRead],
    ["temp written", b.tempWritten],
  ].filter(([, n]) => Number(n) > 0);
  return parts.map(([name, n]) => `${name} ${count(Number(n))}`).join(" · ");
}

/** The statement's totals, each as a label and a value; none when the plan has no summary. */
export function totals(/** @type {PlanNode} */ root) {
  const s = root.summary;
  /** @type {[string, string][]} */
  const out = [];
  if (!s) return out;
  if (s.planning !== null) out.push(["Planning", ms(s.planning)]);
  if (s.execution !== null) out.push(["Execution", ms(s.execution)]);
  const buffers = buffersText(s.buffers);
  if (buffers) out.push(["Buffers", buffers]);
  const planned = buffersText(s.planningBuffers);
  if (planned) out.push(["Planning buffers", planned]);
  if (s.wal && (s.wal.records || s.wal.bytes))
    out.push([
      "WAL",
      `${count(s.wal.records)} records · ${count(s.wal.bytes)} bytes${s.wal.fpi ? ` · ${count(s.wal.fpi)} full pages` : ""}`,
    ]);
  if (s.triggers.length) {
    const time = s.triggers.reduce((sum, t) => sum + (t.time ?? 0), 0);
    const each = s.triggers.map(
      (t) => `${t.name}${t.calls !== null ? ` × ${count(t.calls)}` : ""}`,
    );
    out.push(["Triggers", `${ms(time)} (${each.join(", ")})`]);
  }
  if (s.jit)
    out.push([
      "JIT",
      `${s.jit.functions ?? 0} functions${s.jit.time !== null ? ` · ${ms(s.jit.time)}` : ""}`,
    ]);
  if (s.serialization)
    out.push([
      "Serialization",
      `${s.serialization.time !== null ? ms(s.serialization.time) : "?"} · ${count(s.serialization.bytes ?? 0)} kB`,
    ]);
  if (s.memory) out.push(["Planner memory", `${count(s.memory.used ?? 0)} kB`]);
  const settings = Object.entries(s.settings);
  if (settings.length) out.push(["Settings", settings.map(([k, v]) => `${k} = ${v}`).join(", ")]);
  return out;
}
