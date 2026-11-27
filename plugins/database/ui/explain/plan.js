// A query plan as a tree (item 6 of #540): PostgreSQL's EXPLAIN (FORMAT JSON), with or without
// ANALYZE (postgres.js); MySQL's EXPLAIN FORMAT=JSON (and MariaDB's, and its ANALYZE FORMAT=JSON);
// MySQL's EXPLAIN ANALYZE tree; SQLite's EXPLAIN QUERY PLAN rows. Each node keeps its estimated
// cost and rows and, when the statement ran, its time and rows over all loops; `share` is the part
// of the whole that is the node's own (node.js), and `hot` marks where most of it goes. Pure: the
// plan worker (worker.js) runs it on a big plan.

import { t as messageText } from "../strings/index.js";
import { annotate, flatten, missed, node, num, ratioOf } from "./node.js";
import { explainPostgres } from "./options.js";
import { postgresPlan } from "./postgres.js";

export { annotate, flatten, postgresPlan };

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("./node.js").PlanNode} PlanNode
 * @typedef {import("./options.js").Chosen} Chosen
 */

/** The plan in a result set, read by its shape; undefined when it holds none. */
export function planOf(/** @type {ResultSet} */ set) {
  const [first] = set.columns;
  const text = set.rows
    .map((row) => row[0] ?? "")
    .join("\n")
    .trim();
  if (set.columns.join(",") === "id,parent,notused,detail") return sqlitePlan(set.rows);
  if (first === "QUERY PLAN" && text.startsWith("[")) return postgresPlan(JSON.parse(text), text);
  if ((first === "EXPLAIN" || first === "ANALYZE") && text.startsWith("{"))
    return mysqlJsonPlan(JSON.parse(text));
  if (first === "EXPLAIN" && text.startsWith("->")) return mysqlTreePlan(text);
  return undefined;
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
      out.push(
        node({
          label: messageText("explain.plan.nestedLoop"),
          children: o.nested_loop.flatMap(inside),
        }),
      );
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
      out.push(
        node({
          label: messageText("explain.plan.union"),
          children: specs.map((s) => block(s.query_block)),
        }),
      );
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
      label: messageText("explain.plan.on", {
        access: String(access),
        value: String(t.table_name ?? "?"),
        key: String(key),
      }),
      detail: t.attached_condition
        ? messageText("explain.plan.condition", {
            attached_condition: String(t.attached_condition),
          })
        : "",
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
  const root = node({ label: messageText("explain.plan.query") });
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
    const rows = cost ? Number(cost[2]) : null;
    const made = node({
      label,
      cost: cost ? Number(cost[1]) : null,
      rows,
      actualRows: actual ? Number(actual[2]) * loops : null,
      loops: actual ? loops : null,
      time: actual ? Number(actual[1]) * loops : null,
      misestimate: actual && loops > 0 ? ratioOf(rows, Number(actual[2])) : null,
    });
    const miss = missed(made);
    if (miss) made.marks.push(miss);
    while ((stack[stack.length - 1]?.depth ?? -1) >= depth) stack.pop();
    stack[stack.length - 1]?.node.children.push(made);
    stack.push({ depth, node: made });
  }
  const only = root.children.length === 1 ? root.children[0] : undefined;
  return annotate(only ?? root);
}

/** SQLite's EXPLAIN QUERY PLAN rows (id, parent, notused, detail); a full SCAN is marked. */
export function sqlitePlan(/** @type {(string | null)[][]} */ rows) {
  const root = node({ label: messageText("explain.plan.queryPlan") });
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
 * The EXPLAIN to run for a statement, per dialect and flavor; PostgreSQL's with the options chosen
 * (options.js), or ANALYZE with BUFFERS as before when none are given.
 * @param {import("../sql/lexer.js").Dialect} dialect
 * @param {"mysql" | "mariadb" | string} flavor
 * @param {string} statement
 * @param {boolean} analyze
 * @param {Chosen} [chosen]
 */
export function explainSql(dialect, flavor, statement, analyze, chosen) {
  if (dialect === "postgresql")
    return chosen
      ? explainPostgres(statement, { ...chosen, analyze })
      : `EXPLAIN (${analyze ? "ANALYZE, BUFFERS, " : ""}FORMAT JSON) ${statement}`;
  if (dialect === "mysql") {
    if (flavor === "mariadb") return `${analyze ? "ANALYZE" : "EXPLAIN"} FORMAT=JSON ${statement}`;
    return analyze ? `EXPLAIN ANALYZE ${statement}` : `EXPLAIN FORMAT=JSON ${statement}`;
  }
  if (analyze) throw new Error(messageText("explain.plan.sqliteHasNoExplainAnalyzeExplain"));
  return `EXPLAIN QUERY PLAN ${statement}`;
}
