// The warnings a statement's own shape shows (ADR 0328): SELECT * where it is fixed or paired by
// position (a view's or materialized view's output, INSERT ... SELECT), UPDATE or DELETE without
// WHERE, LIMIT, OFFSET or FETCH FIRST without ORDER BY, INSERT without a column list (with the
// cached columns as the fix, as many as it has values), and a call that cancels or ends a server
// session. Pure.
import { fieldsOf, kindOf, listOf, walk } from "../sql/parse/tree.js";
import { startOf } from "./insert.js";
import { isNull, partsOf } from "./warn-context.js";

/**
 * @typedef {import("./warn-context.js").WarnContext} WarnContext
 * @typedef {import("../sql/parse/tree.js").Node} Node
 */

const STAR = {
  view: "SELECT * in a view is expanded once, when the view is made: columns added later are left out, and none can be dropped while the view stands.",
  insert:
    "INSERT ... SELECT * pairs columns by position: a column added to either table later shifts the values.",
};
const SIGNALS = /** @type {Record<string, string>} */ ({
  pg_terminate_backend:
    "pg_terminate_backend ends a server session and rolls back its open transaction: a read-only connection refuses it, and production and agents ask first.",
  pg_cancel_backend:
    "pg_cancel_backend cancels a server session's statement: a read-only connection refuses it, and production and agents ask first.",
});

/** The `*` items of the select lists that make a query's output (each arm of a UNION). */
function stars(
  /** @type {WarnContext} */ ctx,
  /** @type {Node | undefined} */ s,
  /** @type {string} */ message,
) {
  if (!s) return;
  if (s.op && s.op !== "SETOP_NONE") {
    stars(ctx, s.larg, message);
    stars(ctx, s.rarg, message);
    return;
  }
  for (const target of listOf(s.targetList)) {
    const ref = fieldsOf(fieldsOf(target, "ResTarget")?.val, "ColumnRef");
    if (!ref || kindOf(listOf(ref.fields).at(-1)) !== "A_Star") continue;
    const from = ctx.offsetOf(ref.location ?? 0);
    const star = ctx.after(from).find((t) => t.type === "op" && t.text === "*");
    ctx.put("select-star", { from, to: star ? star.end - ctx.start : from + 1 }, message);
  }
}

export function selectStar(/** @type {WarnContext} */ ctx) {
  walk(ctx.tree, (kind, f) => {
    if (kind === "ViewStmt") stars(ctx, fieldsOf(f.query, "SelectStmt"), STAR.view);
    else if (kind === "CreateTableAsStmt" && f.objtype === "OBJECT_MATVIEW")
      stars(ctx, fieldsOf(f.query, "SelectStmt"), STAR.view);
    else if (kind === "InsertStmt") {
      const s = fieldsOf(f.selectStmt, "SelectStmt");
      if (s && !s.valuesLists) stars(ctx, s, STAR.insert);
    }
  });
}

export function writesWithoutWhere(/** @type {WarnContext} */ ctx) {
  walk(ctx.tree, (kind, f) => {
    if ((kind !== "UpdateStmt" && kind !== "DeleteStmt") || f.whereClause || !f.relation) return;
    const [rule, message] =
      kind === "UpdateStmt"
        ? [
            "update-without-where",
            `UPDATE without WHERE changes every row of ${f.relation.relname}.`,
          ]
        : [
            "delete-without-where",
            `DELETE without WHERE removes every row of ${f.relation.relname}.`,
          ];
    ctx.put(rule, ctx.relationSpan(f.relation), message);
  });
}

/** Whether a query (or an arm of its UNION) reads a FROM. */
const reads = (/** @type {Node | undefined} */ s) =>
  !!s && (listOf(s.fromClause).length > 0 || reads(s.larg) || reads(s.rarg));

const KEYWORDS = new Set(["LIMIT", "OFFSET", "FETCH"]);

export function limitWithoutOrder(/** @type {WarnContext} */ ctx) {
  /** @type {Set<unknown>} */
  const exists = new Set();
  walk(ctx.tree, (kind, f) => {
    if (kind === "SubLink" && f.subLinkType === "EXISTS_SUBLINK")
      exists.add(fieldsOf(f.subselect, "SelectStmt"));
    if (kind !== "SelectStmt" || exists.has(f) || listOf(f.sortClause).length > 0) return;
    const count = f.limitCount && !isNull(f.limitCount) ? f.limitCount : undefined;
    const expr = count ?? f.limitOffset;
    if (!expr || !reads(f)) return;
    const at = ctx.offsetOf(startOf(expr));
    const word = ctx
      .before(at)
      .find((t) => t.type === "word" && KEYWORDS.has(t.text.toUpperCase()));
    const from = word ? word.start - ctx.start : at;
    const said = (word?.text.toUpperCase() ?? (count ? "LIMIT" : "OFFSET")).replace(
      "FETCH",
      "FETCH FIRST",
    );
    const verb = said === "OFFSET" ? "skips" : "returns";
    ctx.put(
      "limit-without-order",
      { from, to: ctx.tokenEnd(at) },
      `${said} without ORDER BY ${verb} whichever rows the server reaches first, and they can differ from run to run.`,
    );
  });
}

/** How many values an INSERT's rows have, when it is told (VALUES, a select list without *). */
function valuesOf(/** @type {unknown} */ select) {
  const s = fieldsOf(select, "SelectStmt");
  if (!s) return 0;
  if (s.valuesLists) return listOf(fieldsOf(listOf(s.valuesLists)[0], "List")?.items).length;
  if (s.op && s.op !== "SETOP_NONE") return 0;
  const targets = listOf(s.targetList);
  const star = targets.some(
    (t) =>
      kindOf(listOf(fieldsOf(fieldsOf(t, "ResTarget")?.val, "ColumnRef")?.fields).at(-1)) ===
      "A_Star",
  );
  return star ? 0 : targets.length;
}

/** A column as an INSERT's list may write it: quoted unless a plain name the grammar takes there. */
function columnName(/** @type {WarnContext} */ ctx, /** @type {string} */ name) {
  const plain = /^[a-z_][a-z0-9_$]*$/u.test(name);
  const scanned = plain ? ctx.raw.scan(name) : undefined;
  const kind = scanned && "tokens" in scanned ? (scanned.tokens[0]?.keywordKind ?? 0) : 3;
  return plain && kind <= 2 ? name : `"${name.replaceAll('"', '""')}"`;
}

export function insertWithoutColumns(/** @type {WarnContext} */ ctx) {
  walk(ctx.tree, (kind, f) => {
    if (kind !== "InsertStmt" || !f.relation || !f.selectStmt || listOf(f.cols).length > 0) return;
    const span = ctx.relationSpan(f.relation);
    if (f.relation.alias?.aliasname) {
      const alias = ctx.after(span.to).find((t) => t.type === "word" || t.type === "name");
      const named =
        alias?.text.toUpperCase() === "AS" ? ctx.after(alias.end - ctx.start)[0] : alias;
      if (named) span.to = named.end - ctx.start;
    }
    const message = `INSERT without a column list fills the columns of ${f.relation.relname} by position: a column added later shifts the values.`;
    const count = valuesOf(f.selectStmt);
    const columns = [...(ctx.relation(f.relation)?.columns?.keys() ?? [])];
    if (count === 0 || columns.length < count)
      return ctx.put("insert-without-columns", span, message);
    const list = columns.slice(0, count).map((c) => columnName(ctx, c));
    const old = ctx.text.slice(span.from + 1, span.to + 1);
    ctx.put("insert-without-columns", span, message, {
      title: "List the columns",
      text: `${old} (${list.join(", ")})`,
    });
  });
}

export function serverSignal(/** @type {WarnContext} */ ctx) {
  walk(ctx.tree, (kind, f) => {
    if (kind !== "FuncCall") return;
    const parts = partsOf(f.funcname);
    const message = SIGNALS[parts.at(-1) ?? ""];
    if (!message || (parts.length > 1 && parts[0] !== "pg_catalog")) return;
    const from = ctx.offsetOf(f.location ?? 0);
    ctx.put("server-signal", { from, to: ctx.nameEnd(from, parts.length) }, message);
  });
}
