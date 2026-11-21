// What every PG-50 kind's DDL shares: the owner on its first line (a comment, so the DDL applies
// where that role does not exist), the COMMENT ON statement after it, names quoted, and an
// OPTIONS clause from `name=value` options. Pure.

import { quoteName, quoteText } from "../../sql/quote.js";

/** A name quoted as PostgreSQL needs it. */
export const ident = (/** @type {string} */ name) => quoteName("postgresql", name);
/** A string literal. */
export const literal = (/** @type {string} */ value) => quoteText("postgresql", value);
/** `schema.name`, each quoted; just the name when there is no schema. */
export const dotted = (/** @type {string} */ schema, /** @type {string} */ name) =>
  schema ? `${ident(schema)}.${ident(name)}` : ident(name);

/** `-- Owner: role` and a line break, or "" when it has none. */
export const ownerLine = (/** @type {string | undefined} */ owner) =>
  owner ? `-- Owner: ${owner}\n` : "";

/** `COMMENT ON <what> <target> IS '...';`, or "" without a comment. */
export const commentOn = (
  /** @type {string} */ what,
  /** @type {string} */ target,
  /** @type {string | undefined} */ comment,
) => (comment ? `COMMENT ON ${what} ${target} IS ${literal(comment)};\n` : "");

/** `OPTIONS (a 'b', c 'd')` from `a=b` texts, or "" when there are none. */
export function optionsClause(/** @type {unknown} */ options) {
  const list = Array.isArray(options) ? options.map(String) : [];
  if (list.length === 0) return "";
  const pairs = list.map((o) => {
    const at = o.indexOf("=");
    const name = at < 0 ? o : o.slice(0, at);
    return `${ident(name)} ${literal(at < 0 ? "" : o.slice(at + 1))}`;
  });
  return ` OPTIONS (${pairs.join(", ")})`;
}

/** A line saying how many options were left out, or "". */
export const hiddenLine = (/** @type {unknown} */ hidden) => {
  const n = Number(hidden) || 0;
  return n > 0
    ? `-- ${n} option${n === 1 ? " is" : "s are"} not shown: ${n === 1 ? "it" : "they"} may hold a secret.\n`
    : "";
};

/** The owner line, the statements, then the comment: one DDL text. */
export const assemble = (
  /** @type {string | undefined} */ owner,
  /** @type {string[]} */ statements,
  /** @type {string} */ comment = "",
) => `${ownerLine(owner)}${statements.join("")}${comment}`;
