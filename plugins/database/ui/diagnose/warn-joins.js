// A join with no condition (ADR 0328): tables or views listed side by side in FROM (or UPDATE's
// FROM, DELETE's USING) that no condition of WHERE or HAVING links, a JOIN whose ON is always true
// between two tables, and a NATURAL JOIN of two tables that share no column: every row of one pairs
// with every row of the other. CROSS JOIN is taken as meant, and so is anything but a table or a
// view (a CTE, a function, a subquery, LATERAL). A condition with a column the cache cannot place
// links everything, so a doubt is silence. Pure.
import { fieldsOf, kindOf, listOf, walk } from "../sql/parse/tree.js";
import { startOf } from "./insert.js";
import { opOf, partsOf } from "./warn-context.js";

/**
 * @typedef {import("./warn-context.js").WarnContext} WarnContext
 * @typedef {import("../sql/parse/tree.js").Node} Node
 * @typedef {{ names: Set<string>, bases: Node[], columns: Set<string> | null, node: unknown }} Item
 *   A FROM item: the names it is reached by, the tables and views in it, its columns when known.
 */

const RULE = "join-without-condition";

/** A table's name as the message says it: with its alias when it has one. */
const label = (/** @type {Node} */ rv) =>
  rv.alias?.aliasname ? `${rv.relname} ${rv.alias.aliasname}` : rv.relname;

/** @returns {Item} */
function itemOf(
  /** @type {WarnContext} */ ctx,
  /** @type {unknown} */ node,
  /** @type {Set<string>} */ ctes,
) {
  const rv = fieldsOf(node, "RangeVar");
  if (rv) {
    const name = rv.alias?.aliasname ?? rv.relname ?? "";
    if (!rv.schemaname && ctes.has(rv.relname))
      return { names: new Set([name]), bases: [], columns: null, node };
    const found = ctx.relation(rv);
    const columns = found?.columns ? new Set(found.columns.keys()) : null;
    return { names: new Set([name]), bases: [rv], columns, node };
  }
  const join = fieldsOf(node, "JoinExpr");
  if (join) {
    const [l, r] = [itemOf(ctx, join.larg, ctes), itemOf(ctx, join.rarg, ctes)];
    const columns = l.columns && r.columns ? new Set([...l.columns, ...r.columns]) : null;
    const names = new Set([...l.names, ...r.names]);
    if (join.alias?.aliasname) names.add(join.alias.aliasname);
    return { names, bases: [...l.bases, ...r.bases], columns, node };
  }
  const alias = fieldsOf(node, kindOf(node))?.alias?.aliasname;
  return { names: new Set(alias ? [alias] : []), bases: [], columns: null, node };
}

/** The conditions ANDed together in a WHERE or HAVING. */
function conjuncts(/** @type {unknown} */ where) {
  /** @type {unknown[]} */
  const out = [];
  /** @type {unknown[]} */
  const stack = where ? [where] : [];
  while (stack.length > 0) {
    const c = stack.pop();
    const and = fieldsOf(c, "BoolExpr");
    if (and?.boolop === "AND_EXPR") stack.push(...listOf(and.args));
    else out.push(c);
  }
  return out;
}

/** The items a condition reads (qualified, or a bare column only one item has); null: any. */
function readBy(/** @type {unknown} */ node, /** @type {Item[]} */ items, bare = true) {
  /** @type {Set<number>} */
  const read = new Set();
  let any = false;
  walk(node, (kind, f) => {
    if (kind !== "ColumnRef") return;
    const parts = partsOf(f.fields);
    const star = kindOf(listOf(f.fields).at(-1)) === "A_Star";
    const qualifier = star ? parts.at(-1) : parts.length >= 2 ? parts.at(-2) : undefined;
    if (qualifier !== undefined) {
      const at = items.findIndex((i) => i.names.has(qualifier));
      if (at >= 0) read.add(at);
      return;
    }
    if (!bare || parts.length !== 1) return;
    const name = /** @type {string} */ (parts[0]);
    const holders = items.flatMap((item, i) => (item.columns?.has(name) ? [i] : []));
    if (holders.length === 1) read.add(/** @type {number} */ (holders[0]));
    else if (holders.length === 0 && items.some((item) => item.columns === null)) any = true;
  });
  return any ? null : read;
}

/** Items side by side that nothing links: one warning per group after the first. */
function unlinked(
  /** @type {WarnContext} */ ctx,
  /** @type {Item[]} */ items,
  /** @type {unknown[]} */ conditions,
) {
  const root = items.map((_, i) => i);
  const find = (/** @type {number} */ i) => {
    let at = i;
    while (root[at] !== at) at = /** @type {number} */ (root[at]);
    return at;
  };
  const link = (/** @type {Iterable<number>} */ group) => {
    const [first, ...rest] = [...group];
    for (const other of rest) root[find(other)] = find(/** @type {number} */ (first));
  };
  for (const condition of conditions) link(readBy(condition, items) ?? items.keys());
  // LATERAL items and functions read the items before them.
  items.forEach((item, i) => {
    if (item.bases.length > 0) return;
    const read = readBy(item.node, items, kindOf(item.node) === "RangeFunction");
    link([i, ...(read ?? items.keys())]);
  });
  const based = items.filter((item) => item.bases.length > 0);
  const first = based[0];
  const seen = new Set(first ? [find(items.indexOf(first))] : []);
  for (const item of based.slice(1)) {
    const at = find(items.indexOf(item));
    if (seen.has(at)) continue;
    seen.add(at);
    const rv = /** @type {Node} */ (item.bases[0]);
    const to = label(/** @type {Node} */ (first?.bases[0]));
    ctx.put(
      RULE,
      ctx.relationSpan(rv),
      `Nothing links ${label(rv)} to ${to}: every row of one pairs with every row of the other.`,
    );
  }
}

/** Whether an ON is always true: `true`, or two equal constants compared with `=`. */
function alwaysTrue(/** @type {unknown} */ quals) {
  if (fieldsOf(quals, "A_Const")?.boolval?.boolval === true) return true;
  const e = fieldsOf(quals, "A_Expr");
  if (e?.kind !== "AEXPR_OP" || opOf(e) !== "=") return false;
  const value = (/** @type {unknown} */ n) => {
    const c = fieldsOf(n, "A_Const");
    if (!c) return undefined;
    const { location: _, ...rest } = c;
    return JSON.stringify(rest);
  };
  const left = value(e.lexpr);
  return left !== undefined && left === value(e.rexpr);
}

/** ON true between two tables, and NATURAL JOIN of tables with no column in common. */
function joined(
  /** @type {WarnContext} */ ctx,
  /** @type {Node} */ f,
  /** @type {Set<string>} */ ctes,
) {
  const [l, r] = [itemOf(ctx, f.larg, ctes), itemOf(ctx, f.rarg, ctes)];
  const [a, b] = [l.bases[0], r.bases[0]];
  if (!a || !b) return;
  if (f.quals && alwaysTrue(f.quals)) {
    const from = ctx.offsetOf(startOf(f.quals));
    const e = fieldsOf(f.quals, "A_Expr");
    const last = e ? ctx.offsetOf(startOf(e.rexpr)) : from;
    ctx.put(
      RULE,
      { from, to: ctx.tokenEnd(last) },
      `This ON is always true: every row of ${label(a)} pairs with every row of ${label(b)}.`,
    );
  } else if (
    f.isNatural &&
    l.columns &&
    r.columns &&
    ![...l.columns].some((c) => r.columns?.has(c))
  )
    ctx.put(
      RULE,
      ctx.relationSpan(b),
      `${label(a)} and ${label(b)} have no column in common, so NATURAL JOIN pairs every row of one with every row of the other.`,
    );
}

/** Every query level's FROM items, and every join's condition. */
export function joinWithoutCondition(/** @type {WarnContext} */ ctx) {
  /** @type {Set<string>} */
  const ctes = new Set();
  walk(ctx.tree, (kind, f) => {
    if (kind === "CommonTableExpr" && f.ctename) ctes.add(f.ctename);
  });
  walk(ctx.tree, (kind, f) => {
    if (kind === "JoinExpr") return void joined(ctx, f, ctes);
    /** @type {unknown[]} */
    let from = [];
    if (kind === "SelectStmt") from = listOf(f.fromClause);
    else if (kind === "UpdateStmt") from = [{ RangeVar: f.relation }, ...listOf(f.fromClause)];
    else if (kind === "DeleteStmt") from = [{ RangeVar: f.relation }, ...listOf(f.usingClause)];
    if (from.length < 2) return;
    const items = from.map((node) => itemOf(ctx, node, ctes));
    unlinked(ctx, items, [...conjuncts(f.whereClause), ...conjuncts(f.havingClause)]);
  });
}
