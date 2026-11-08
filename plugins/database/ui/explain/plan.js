// A query plan as a tree (item 6 of #540): PostgreSQL's EXPLAIN (FORMAT JSON), with or without
// ANALYZE; MySQL's EXPLAIN FORMAT=JSON (and MariaDB's, and its ANALYZE FORMAT=JSON); MySQL's
// EXPLAIN ANALYZE tree; SQLite's EXPLAIN QUERY PLAN rows. Each node keeps its estimated cost and
// rows and, when the statement ran, its time; `share` is the part of the whole that is the node's
// own (its cost or time minus its children's), and `hot` marks where most of it goes. Pure.

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {{
 *   label: string, detail: string, cost: number | null, rows: number | null,
 *   actualRows: number | null, time: number | null, children: PlanNode[],
 *   self: number, share: number, hot: "high" | "medium" | "",
 * }} PlanNode
 *   `cost` and `time` include the children's, as the engines print them; `time` is in ms, over all loops.
 */

const num = (/** @type {unknown} */ v) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** @returns {PlanNode} */
function node(/** @type {Partial<PlanNode> & { label: string }} */ fields) {
  return {
    detail: "",
    cost: null,
    rows: null,
    actualRows: null,
    time: null,
    children: [],
    self: 0,
    share: 0,
    hot: "",
    ...fields,
  };
}

/** The plan in a result set, read by its shape; undefined when it holds none. */
export function planOf(/** @type {ResultSet} */ set) {
  const [first] = set.columns;
  const text = set.rows
    .map((row) => row[0] ?? "")
    .join("\n")
    .trim();
  if (set.columns.join(",") === "id,parent,notused,detail") return sqlitePlan(set.rows);
  if (first === "QUERY PLAN" && text.startsWith("[")) return postgresPlan(JSON.parse(text));
  if ((first === "EXPLAIN" || first === "ANALYZE") && text.startsWith("{"))
    return mysqlJsonPlan(JSON.parse(text));
  if (first === "EXPLAIN" && text.startsWith("->")) return mysqlTreePlan(text);
  return undefined;
}

/** PostgreSQL's JSON plan: [{ "Plan": {...}, "Planning Time", "Execution Time" }]. */
export function postgresPlan(/** @type {any} */ json) {
  const top = Array.isArray(json) ? json[0] : json;
  /** @returns {PlanNode} */
  const walk = (/** @type {any} */ p) => {
    const on = p["Relation Name"]
      ? ` on ${p["Relation Name"]}${p.Alias && p.Alias !== p["Relation Name"] ? ` ${p.Alias}` : ""}`
      : p["CTE Name"]
        ? ` on ${p["CTE Name"]}`
        : "";
    const using = p["Index Name"] ? ` using ${p["Index Name"]}` : "";
    const join = p["Join Type"] && p["Join Type"] !== "Inner" ? ` (${p["Join Type"]})` : "";
    const conditions = [
      "Hash Cond",
      "Merge Cond",
      "Index Cond",
      "Recheck Cond",
      "Join Filter",
      "Filter",
    ]
      .filter((k) => p[k])
      .map((k) => `${k}: ${p[k]}`);
    if (Array.isArray(p["Sort Key"])) conditions.push(`Sort Key: ${p["Sort Key"].join(", ")}`);
    if (Array.isArray(p["Group Key"])) conditions.push(`Group Key: ${p["Group Key"].join(", ")}`);
    const loops = num(p["Actual Loops"]) ?? 1;
    const total = num(p["Actual Total Time"]);
    return node({
      label: `${p["Node Type"] ?? "Node"}${join}${on}${using}`,
      detail: conditions.join(" · "),
      cost: num(p["Total Cost"]),
      rows: num(p["Plan Rows"]),
      actualRows: num(p["Actual Rows"]),
      time: total === null ? null : total * loops,
      children: (p.Plans ?? []).map(walk),
    });
  };
  const root = walk(top?.Plan ?? {});
  return annotate(root);
}

const ACCESS = /** @type {Record<string, string>} */ ({
  ALL: "Full table scan",
  index: "Full index scan",
  range: "Index range scan",
  ref: "Index lookup",
  eq_ref: "Unique index lookup",
  const: "Constant row",
  system: "System table",
  fulltext: "Full-text search",
  ref_or_null: "Index lookup or NULL",
  index_merge: "Index merge",
});
const WRAPPERS = /** @type {Record<string, string>} */ ({
  ordering_operation: "Sort",
  grouping_operation: "Group",
  duplicates_removal: "Remove duplicates",
  windowing: "Window",
  buffer_result: "Buffer",
});

/** MySQL's (and MariaDB's) JSON plan: { query_block: { table | nested_loop | ordering_operation ... } }. */
export function mysqlJsonPlan(/** @type {any} */ json) {
  /** @returns {PlanNode[]} */
  const inside = (/** @type {any} */ o) => {
    if (!o || typeof o !== "object") return [];
    /** @type {PlanNode[]} */
    const out = [];
    if (o.table) out.push(table(o.table));
    if (Array.isArray(o.nested_loop))
      out.push(node({ label: "Nested loop", children: o.nested_loop.flatMap(inside) }));
    for (const [key, label] of Object.entries(WRAPPERS))
      if (o[key]) {
        const w = o[key];
        const notes = [
          w.using_filesort ? "filesort" : "",
          w.using_temporary_table ? "temporary table" : "",
        ];
        const extra = notes.filter(Boolean).join(", ");
        out.push(
          node({
            label: `${label}${extra ? ` (${extra})` : ""}`,
            cost: num(w.cost_info?.sort_cost),
            time: num(w.r_total_time_ms),
            children: inside(w),
          }),
        );
      }
    if (o.union_result) {
      const specs = o.union_result.query_specifications ?? [];
      out.push(node({ label: "Union", children: specs.map((s) => block(s.query_block)) }));
    }
    for (const key of ["attached_subqueries", "optimized_away_subqueries"])
      for (const sub of o[key] ?? []) out.push(block(sub.query_block, "Subquery"));
    if (o.materialized_from_subquery)
      out.push(block(o.materialized_from_subquery.query_block, "Materialized subquery"));
    return out;
  };
  /** @returns {PlanNode} */
  const table = (/** @type {any} */ t) => {
    const access = ACCESS[t.access_type] ?? t.access_type ?? "Access";
    const key = t.key ? ` using ${t.key}` : "";
    const own = (num(t.cost_info?.read_cost) ?? 0) + (num(t.cost_info?.eval_cost) ?? 0);
    return node({
      label: `${access} on ${t.table_name ?? "?"}${key}`,
      detail: t.attached_condition ? `Condition: ${t.attached_condition}` : "",
      cost: t.cost_info ? own : null,
      rows: num(t.rows_examined_per_scan ?? t.rows),
      actualRows: num(t.r_rows),
      time: num(t.r_total_time_ms),
      children: inside(t),
    });
  };
  /** @returns {PlanNode} */
  const block = (/** @type {any} */ b, label = "Query block") =>
    node({
      label: `${label}${b?.select_id ? ` #${b.select_id}` : ""}`,
      cost: num(b?.cost_info?.query_cost),
      time: num(b?.r_total_time_ms),
      children: inside(b),
    });
  // MySQL's table costs are each its own; the query block's is the whole. Children's costs are
  // summed into each wrapper so that cost reads as cumulative, as PostgreSQL's does.
  const root = block(json.query_block ?? json);
  cumulate(root);
  return annotate(root);
}

/** Make each node's cost include its children's, keeping a cost the engine gave for the whole. */
function cumulate(/** @type {PlanNode} */ n) {
  const below = n.children.reduce((sum, child) => sum + cumulate(child), 0);
  if (n.label.startsWith("Query block") && n.cost !== null) return n.cost;
  n.cost = n.cost === null && below === 0 ? null : (n.cost ?? 0) + below;
  return n.cost ?? 0;
}

/** MySQL's EXPLAIN ANALYZE (or FORMAT=TREE): one `-> ...` line per node, indented by depth. */
export function mysqlTreePlan(/** @type {string} */ text) {
  const root = node({ label: "Query" });
  /** @type {{ depth: number, node: PlanNode }[]} */
  const stack = [{ depth: -1, node: root }];
  for (const line of text.split("\n")) {
    const match = /^(\s*)-> (.*)$/u.exec(line);
    if (!match) continue;
    const depth = (match[1] ?? "").length;
    const body = match[2] ?? "";
    const cost = /\(cost=([\d.e+]+)(?:\.\.[\d.e+]+)? rows=([\d.e+]+)\)/u.exec(body);
    const actual = /\(actual time=[\d.e+]+\.\.([\d.e+]+) rows=([\d.e+]+) loops=(\d+)\)/u.exec(body);
    const label = body.replace(/\s*\((?:cost|actual time)=[^)]*\)/gu, "").trim();
    const loops = Number(actual?.[3] ?? 1);
    const made = node({
      label,
      cost: cost ? Number(cost[1]) : null,
      rows: cost ? Number(cost[2]) : null,
      actualRows: actual ? Number(actual[2]) * loops : null,
      time: actual ? Number(actual[1]) * loops : null,
    });
    while ((stack[stack.length - 1]?.depth ?? -1) >= depth) stack.pop();
    stack[stack.length - 1]?.node.children.push(made);
    stack.push({ depth, node: made });
  }
  const only = root.children.length === 1 ? root.children[0] : undefined;
  return annotate(only ?? root);
}

/** SQLite's EXPLAIN QUERY PLAN rows (id, parent, notused, detail); a full SCAN is marked. */
export function sqlitePlan(/** @type {(string | null)[][]} */ rows) {
  const root = node({ label: "Query plan" });
  /** @type {Map<string, PlanNode>} */
  const byId = new Map([["0", root]]);
  for (const [id, parent, , detail] of rows) {
    const text = detail ?? "";
    const full = /^SCAN /u.test(text) && !/USING (?:COVERING )?INDEX/u.test(text);
    const made = node({ label: text, hot: full ? "medium" : "" });
    (byId.get(parent ?? "0") ?? root).children.push(made);
    byId.set(id ?? "", made);
  }
  return root;
}

/**
 * Work out each node's own share of the whole (by time when the statement ran, else by cost) and
 * mark the nodes that take half of it (high) or a fifth (medium).
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

/** The EXPLAIN to run for a statement, per dialect and flavor. */
export function explainSql(
  /** @type {import("../sql/lexer.js").Dialect} */ dialect,
  /** @type {"mysql" | "mariadb" | string} */ flavor,
  /** @type {string} */ statement,
  /** @type {boolean} */ analyze,
) {
  if (dialect === "postgresql")
    return `EXPLAIN (${analyze ? "ANALYZE, BUFFERS, " : ""}FORMAT JSON) ${statement}`;
  if (dialect === "mysql") {
    if (flavor === "mariadb") return `${analyze ? "ANALYZE" : "EXPLAIN"} FORMAT=JSON ${statement}`;
    return analyze ? `EXPLAIN ANALYZE ${statement}` : `EXPLAIN FORMAT=JSON ${statement}`;
  }
  if (analyze) throw new Error("SQLite has no EXPLAIN ANALYZE: Explain shows its query plan.");
  return `EXPLAIN QUERY PLAN ${statement}`;
}
