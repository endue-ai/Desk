// Why a PostgreSQL plan node is slow, in words: a sequential scan that filters most of what it reads
// away, a sort, hash or aggregate that spilled to disk, a nested loop whose inner side runs many
// times, and an index scan whose filter throws away what the index found. The misestimate mark is
// every engine's (node.js). Read from the node's JSON and what the reader made of it. Pure.

/**
 * @typedef {import("./node.js").PlanNode} PlanNode
 * @typedef {import("./node.js").Mark} Mark
 */

/** A sequential scan marked when it removes this share or more of what it reads, */
const FILTERED = 0.9;
/** and reads at least this many rows. */
const FILTERED_MIN = 1000;
/** A nested loop marked when its inner side runs this many times or more. */
const LOOPS = 1000;
/** An index scan's filter marked when it removes at least this many rows, and as many as it keeps. */
const INDEX_REMOVED = 100;

const count = (/** @type {number} */ n) => Math.round(n).toLocaleString();
const INDEXED = new Set(["Index Scan", "Index Only Scan", "Bitmap Heap Scan"]);
const SPILLS = new Set(["Sort", "Incremental Sort", "Hash", "Aggregate", "Materialize", "SetOp"]);

/**
 * @param {any} p The node's JSON.
 * @param {PlanNode} made What the reader made of it, its children read.
 * @returns {Mark[]}
 */
export function marksOf(p, made) {
  /** @type {Mark[]} */
  const marks = [];
  const kind = made.kind;
  const removed = made.removed ?? 0;
  const kept = made.actualRows ?? 0;
  if (
    kind === "Seq Scan" &&
    removed + kept >= FILTERED_MIN &&
    removed >= FILTERED * (removed + kept)
  )
    marks.push({
      kind: "filter",
      level: "high",
      text: `filters ${Math.round((100 * removed) / (removed + kept))}% of the ${count(removed + kept)} rows it reads away`,
    });
  const spill = spilled(p, kind, made.children);
  if (spill) marks.push({ kind: "spill", level: "high", text: spill });
  if (kind === "Nested Loop") {
    const inner = made.children[1];
    const ran = inner?.loops ?? null;
    const outer = made.children[0];
    const estimated = ran === null ? (outer?.rows ?? null) : null;
    if (ran !== null && ran >= LOOPS)
      marks.push({
        kind: "loops",
        level: "medium",
        text: `its inner side ran ${count(ran)} times`,
      });
    else if (estimated !== null && estimated >= LOOPS)
      marks.push({
        kind: "loops",
        level: "medium",
        text: `its inner side runs about ${count(estimated)} times`,
      });
  }
  if (INDEXED.has(kind) && removed >= INDEX_REMOVED && removed >= kept)
    marks.push({
      kind: "index-filter",
      level: "medium",
      text: `its filter removed ${count(removed)} rows the index found, keeping ${count(kept)}`,
    });
  return marks;
}

/** What spilled to disk, in words; undefined when nothing did. */
function spilled(
  /** @type {any} */ p,
  /** @type {string} */ kind,
  /** @type {PlanNode[]} */ children,
) {
  if (!SPILLS.has(kind)) return undefined;
  const method = String(p["Sort Method"] ?? "");
  if (p["Sort Space Type"] === "Disk" || method.startsWith("external"))
    return `the sort spilled to disk (${method || "external"}, ${p["Sort Space Used"] ?? "?"} kB)`;
  const batches = Number(p["Hash Batches"] ?? 0);
  if (kind === "Hash" && batches > 1)
    return `the hash spilled to disk in ${count(batches)} batches`;
  const aggregated = Number(p["HashAgg Batches"] ?? 0);
  if (aggregated > 1 || Number(p["Disk Usage"] ?? 0) > 0)
    return `the hash aggregate spilled to disk (${p["Disk Usage"] ?? "?"} kB)`;
  // A node's blocks include its children's: only what it wrote itself is its spill.
  const below = children.reduce((sum, c) => sum + (c.buffers?.tempWritten ?? 0), 0);
  const own = Number(p["Temp Written Blocks"] ?? 0) - below;
  if (own > 0) return `it wrote ${count(own)} blocks to temporary files`;
  return undefined;
}
