// The warnings about NULL (ADR 0328): `= NULL` and `<> NULL`, which are never true (with IS NULL or
// IS NOT NULL as the fix, in the case the NULL was written in), CASE x WHEN NULL, which never
// matches, and NOT IN over a list holding NULL or a subquery whose column the cache says can be
// NULL, which no row passes once a NULL comes. Pure.
import { fieldsOf, kindOf, listOf } from "../sql/parse/tree.js";
import { isNull, opOf, partsOf } from "./warn-context.js";

/** @typedef {import("./warn-context.js").WarnContext} WarnContext */

const SAID = {
  "=": "= NULL is never true, not even when the value is NULL: IS NULL tests for it.",
  "<>": "<> NULL is never true, whatever the value: IS NOT NULL tests for it.",
  case: "CASE ... WHEN NULL never matches, since it compares with = NULL: CASE WHEN ... IS NULL tests for it.",
  list: "NOT IN with a NULL in its list is never true: no row passes.",
};

/** IS NULL or IS NOT NULL, in the case the NULL was written in. */
function test(/** @type {string} */ op, /** @type {string} */ written) {
  const words = op === "=" ? "IS NULL" : "IS NOT NULL";
  return written === written.toLowerCase() ? words.toLowerCase() : words;
}

/** `= NULL`, `<> NULL` (and `!=`), and CASE ... WHEN NULL. */
export function nullComparison(/** @type {WarnContext} */ ctx) {
  ctx.each((kind, f) => {
    if (kind === "CaseExpr" && f.arg)
      for (const when of listOf(f.args)) {
        const expr = fieldsOf(when, "CaseWhen")?.expr;
        if (!isNull(expr)) continue;
        const from = ctx.offsetOf(fieldsOf(expr, "A_Const").location ?? 0);
        ctx.put("null-comparison", { from, to: ctx.tokenEnd(from) }, SAID.case);
      }
    if (kind !== "A_Expr" || f.kind !== "AEXPR_OP") return;
    const op = opOf(f);
    if ((op !== "=" && op !== "<>") || isNull(f.lexpr) === isNull(f.rexpr)) return;
    const message = SAID[op];
    if (isNull(f.rexpr)) {
      const from = ctx.offsetOf(f.location ?? 0);
      const at = ctx.offsetOf(fieldsOf(f.rexpr, "A_Const").location ?? 0);
      const to = ctx.tokenEnd(at);
      const text = test(op, ctx.text.slice(at + 1, to + 1));
      ctx.put("null-comparison", { from, to }, message, {
        title: `Use ${text.toUpperCase()}`,
        text,
      });
      return;
    }
    const from = ctx.offsetOf(fieldsOf(f.lexpr, "A_Const").location ?? 0);
    const written = ctx.text.slice(from + 1, ctx.tokenEnd(from) + 1);
    const ref = fieldsOf(f.rexpr, "ColumnRef");
    if (!ref || kindOf(listOf(ref.fields).at(-1)) === "A_Star") {
      const to = ctx.tokenEnd(ctx.offsetOf(f.location ?? 0));
      ctx.put("null-comparison", { from, to }, message);
      return;
    }
    const span = ctx.refSpan(ref);
    const column = ctx.text.slice(span.from + 1, span.to + 1);
    const text = `${column} ${test(op, written)}`;
    const title = `Use ${test(op, "NULL")}`;
    ctx.put("null-comparison", { from, to: span.to }, message, { title, text });
  });
}

/** Where NOT IN is written from `offset` (NOT, then IN when it follows at once). */
function notInSpan(/** @type {WarnContext} */ ctx, /** @type {number} */ offset) {
  const [not, next] = ctx.after(offset);
  const end = (/** @type {{ end: number }} */ t) => t.end - ctx.start;
  if (!not) return { from: offset, to: offset };
  return { from: offset, to: next?.text.toUpperCase() === "IN" ? end(next) : end(not) };
}

/** Whether a subquery's WHERE says `name IS NOT NULL` among its conditions. */
function guarded(
  /** @type {import("../sql/parse/tree.js").Node} */ select,
  /** @type {string} */ name,
) {
  /** @type {unknown[]} */
  const conditions = [select.whereClause];
  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i];
    const and = fieldsOf(c, "BoolExpr");
    if (and?.boolop === "AND_EXPR") conditions.push(...listOf(and.args));
    const test = fieldsOf(c, "NullTest");
    if (
      test?.nulltesttype === "IS_NOT_NULL" &&
      partsOf(fieldsOf(test.arg, "ColumnRef")?.fields).at(-1) === name
    )
      return true;
  }
  return false;
}

/** NOT IN (..., NULL, ...) and NOT IN over a subquery whose column can be NULL. */
export function notInNull(/** @type {WarnContext} */ ctx) {
  ctx.each((kind, f) => {
    if (kind === "A_Expr" && f.kind === "AEXPR_IN" && opOf(f) === "<>") {
      const items = listOf(fieldsOf(f.rexpr, "List")?.items);
      if (items.some(isNull))
        ctx.put("not-in-null", notInSpan(ctx, ctx.offsetOf(f.location ?? 0)), SAID.list);
      return;
    }
    if (kind !== "BoolExpr" || f.boolop !== "NOT_EXPR") return;
    const link = fieldsOf(listOf(f.args)[0], "SubLink");
    if (
      link?.subLinkType !== "ANY_SUBLINK" ||
      (link.operName && opOf({ name: link.operName }) !== "=")
    )
      return;
    const select = fieldsOf(link.subselect, "SelectStmt");
    const targets = listOf(select?.targetList);
    if (!select || (select.op && select.op !== "SETOP_NONE") || targets.length !== 1) return;
    const ref = fieldsOf(fieldsOf(targets[0], "ResTarget")?.val, "ColumnRef");
    const column = ref ? ctx.column(ref) : null;
    // Only a column the cache read (with its type) can be told nullable.
    if (!column?.type || column.notNull || guarded(select, column.name)) return;
    ctx.put(
      "not-in-null",
      notInSpan(ctx, ctx.offsetOf(f.location ?? 0)),
      `NOT IN is never true once its subquery returns a NULL, and ${column.relation}.${column.name} can be NULL: NOT EXISTS has no such trap.`,
    );
  });
}
