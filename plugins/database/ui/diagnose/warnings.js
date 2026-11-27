// The SQL warnings (PG-36, ADR 0328): statements the server runs that are likely mistakes, found in
// the parse worker beside the problems, from the statement's tree, the names the resolver bound and
// what the schema cache holds. Each has an identifier and a one-line reason; a fix only where the
// rewrite cannot change more than the warning says. What the cache cannot tell is not told. Pure.
import { warnContext } from "./warn-context.js";
import { joinWithoutCondition } from "./warn-joins.js";
import { notInNull, nullComparison } from "./warn-null.js";
import {
  insertWithoutColumns,
  limitWithoutOrder,
  selectStar,
  serverSignal,
  writesWithoutWhere,
} from "./warn-statements.js";
import { columnCast, functionOnIndexedColumn } from "./warn-types.js";

/** The identifiers, in the order the settings list them. */
export const WARNINGS = Object.freeze([
  "null-comparison",
  "join-without-condition",
  "select-star",
  "column-cast",
  "not-in-null",
  "update-without-where",
  "delete-without-where",
  "limit-without-order",
  "function-on-indexed-column",
  "insert-without-columns",
  "server-signal",
  // A PL/pgSQL body's (plpgsql-checks.js, ADR 0343).
  "unused-variable",
  "unreachable-code",
]);

const RULES = [
  nullComparison,
  joinWithoutCondition,
  selectStar,
  columnCast,
  notInNull,
  writesWithoutWhere,
  limitWithoutOrder,
  functionOnIndexedColumn,
  insertWithoutColumns,
  serverSignal,
];

/**
 * The warnings of one statement, in its offsets.
 * @param {import("./warn-context.js").Input} input
 * @returns {import("./names.js").Problem[]}
 */
export function warningsOf(input) {
  const ctx = warnContext(input);
  for (const rule of RULES) rule(ctx);
  return ctx.out;
}
