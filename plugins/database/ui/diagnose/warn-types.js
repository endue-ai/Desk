// The warnings about a column in a condition that an index on it cannot serve (ADR 0328), read from
// the cache's column types and index definitions: a column the server casts to compare it with a
// value of another type (integer against numeric or float, numeric against float, character(n)
// against text or varchar: where PostgreSQL has no operator for the pair and casts the column side),
// and a function over a column that leads a btree or hash index, when no index of the table is on
// an expression of that column. Conditions are WHERE, HAVING and JOIN ... ON; the select list is
// not a condition. The index definitions (pg_get_indexdef's words) are parsed once per relation of
// the model. Pure.
import { fieldsOf, listOf, walk } from "../sql/parse/tree.js";
import { opOf, partsOf } from "./warn-context.js";

/**
 * @typedef {import("./warn-context.js").WarnContext} WarnContext
 * @typedef {import("./warn-context.js").Column} Column
 * @typedef {import("../sql/parse/tree.js").Node} Node
 * @typedef {{ leading: Map<string, string>, expressions: Set<string> }} Indexes
 *   The columns that lead a btree or hash index (with its name), and those an expression key names.
 */

const COMPARE = new Set(["=", "<>", "<", ">", "<=", ">="]);
const RANGES = new Set([
  "AEXPR_IN",
  "AEXPR_BETWEEN",
  "AEXPR_NOT_BETWEEN",
  "AEXPR_BETWEEN_SYM",
  "AEXPR_NOT_BETWEEN_SYM",
]);
const LIKES = new Set(["AEXPR_LIKE", "AEXPR_ILIKE"]);
const CAST_NAMES = /** @type {Record<string, string>} */ ({
  int2: "int",
  int4: "int",
  int8: "int",
  numeric: "numeric",
  float4: "float",
  float8: "float",
  text: "text",
  varchar: "text",
  bpchar: "char",
});
/** What the server casts a column of the first kind to, against a value of the second. */
const CASTS = /** @type {Record<string, string>} */ ({
  "int numeric": "numeric",
  "int float": "double precision",
  "numeric float": "double precision",
  "char text": "text",
});

/** The kind of a type as the catalog writes it (format_type). */
function kindOfType(/** @type {string} */ type) {
  const t = type.toLowerCase();
  if (/^(?:smallint|integer|bigint)\b/u.test(t)) return "int";
  if (/^(?:numeric|decimal)\b/u.test(t)) return "numeric";
  if (/^(?:real|double precision)\b/u.test(t)) return "float";
  if (/^(?:character varying|text)\b/u.test(t)) return "text";
  if (/^character\b/u.test(t)) return "char";
  return "";
}

/** The conditions of the statement: each WHERE, HAVING and ON. */
function conditions(/** @type {Node} */ tree) {
  /** @type {unknown[]} */
  const out = [];
  walk(tree, (kind, f) => {
    if (kind === "SelectStmt") out.push(f.whereClause, f.havingClause);
    else if (kind === "UpdateStmt" || kind === "DeleteStmt") out.push(f.whereClause);
    else if (kind === "JoinExpr") out.push(f.quals);
  });
  return out.filter(Boolean);
}

/** Each comparison in the conditions, as its two sides (a range's right side is its list). */
function comparisons(/** @type {Node} */ tree, /** @type {boolean} */ likes) {
  /** @type {Array<{ left: unknown, right: unknown[] }>} */
  const out = [];
  for (const root of conditions(tree))
    walk(root, (kind, f) => {
      if (kind === "SelectStmt") return false;
      if (kind !== "A_Expr") return;
      if ((f.kind === "AEXPR_OP" && COMPARE.has(opOf(f))) || (likes && LIKES.has(f.kind)))
        out.push({ left: f.lexpr, right: [f.rexpr] }, { left: f.rexpr, right: [f.lexpr] });
      else if (RANGES.has(f.kind))
        out.push({ left: f.lexpr, right: listOf(fieldsOf(f.rexpr, "List")?.items) });
    });
  return out;
}

/** The kind of a value's type, when the statement or the cache tells it. */
function valueKind(/** @type {WarnContext} */ ctx, /** @type {unknown} */ node) {
  const c = fieldsOf(node, "A_Const");
  if (c) return c.fval ? "numeric" : c.ival ? "int" : "";
  const cast = fieldsOf(node, "TypeCast");
  if (cast) return CAST_NAMES[partsOf(cast.typeName?.names).at(-1) ?? ""] ?? "";
  const ref = fieldsOf(node, "ColumnRef");
  return ref ? kindOfType(ctx.column(ref)?.type ?? "") : "";
}

export function columnCast(/** @type {WarnContext} */ ctx) {
  /** @type {Set<number>} */
  const told = new Set();
  for (const { left, right } of comparisons(ctx.tree, false)) {
    const ref = fieldsOf(left, "ColumnRef");
    const column = ref ? ctx.column(ref) : null;
    if (!ref || !column?.type || told.has(ref.location ?? -1)) continue;
    const mine = kindOfType(column.type);
    const to = right.map((v) => CASTS[`${mine} ${valueKind(ctx, v)}`]).find(Boolean);
    if (!to) continue;
    told.add(ref.location ?? -1);
    ctx.put(
      "column-cast",
      ctx.refSpan(ref),
      `${column.name} is ${column.type} and is compared with a ${to} value: the server casts ${column.name} to ${to}, so an index on ${column.name} cannot be used.`,
    );
  }
}

/** @type {WeakMap<object, Indexes>} */
const parsed = new WeakMap();

/** A relation's indexes, from their definitions. */
function indexesOf(/** @type {WarnContext} */ ctx, /** @type {Column["found"]} */ found) {
  const relation = /** @type {{ indexes?: string[] } | undefined} */ (found?.relation);
  if (!relation) return undefined;
  const kept = parsed.get(relation);
  if (kept) return kept;
  /** @type {Indexes} */
  const made = { leading: new Map(), expressions: new Set() };
  for (const def of relation.indexes ?? []) {
    const read = ctx.raw.parse(def);
    const index = "tree" in read ? fieldsOf(read.tree.stmts?.[0]?.stmt, "IndexStmt") : undefined;
    if (!index) continue;
    const keys = listOf(index.indexParams).map((p) => fieldsOf(p, "IndexElem") ?? {});
    for (const key of keys)
      walk(key.expr, (kind, f) => {
        if (kind === "ColumnRef") made.expressions.add(partsOf(f.fields).at(-1) ?? "");
      });
    const first = keys[0]?.name;
    const plain = index.accessMethod === "btree" || index.accessMethod === "hash";
    if (first && plain && !made.leading.has(first)) made.leading.set(first, index.idxname ?? "");
  }
  parsed.set(relation, made);
  return made;
}

export function functionOnIndexedColumn(/** @type {WarnContext} */ ctx) {
  /** @type {Set<unknown>} */
  const told = new Set();
  for (const { left } of comparisons(ctx.tree, true)) {
    const call = fieldsOf(left, "FuncCall");
    if (!call || call.over || call.agg_star || told.has(call)) continue;
    for (const arg of listOf(call.args)) {
      const ref = fieldsOf(fieldsOf(arg, "TypeCast")?.arg ?? arg, "ColumnRef");
      const column = ref ? ctx.column(ref) : null;
      const indexes = column ? indexesOf(ctx, column.found) : undefined;
      const index = column && indexes?.leading.get(column.name);
      if (!column || !index || indexes?.expressions.has(column.name)) continue;
      told.add(call);
      const from = ctx.offsetOf(call.location ?? 0);
      ctx.put(
        "function-on-indexed-column",
        { from, to: callEnd(ctx, from) },
        `${partsOf(call.funcname).at(-1)}() over ${column.name} keeps the server from using the index ${index}: compare ${column.name} itself, or index the expression.`,
      );
      break;
    }
  }
}

/** Where a call written at `from` ends: its closing parenthesis. */
function callEnd(/** @type {WarnContext} */ ctx, /** @type {number} */ from) {
  let depth = 0;
  for (const t of ctx.after(from)) {
    if (t.type !== "op") continue;
    if (t.text === "(") depth++;
    else if (t.text === ")" && --depth === 0) return t.end - ctx.start;
  }
  return ctx.tokenEnd(from);
}
