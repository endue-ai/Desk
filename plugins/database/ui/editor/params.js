// Parameters in a statement: `:name` everywhere, `?` on MySQL and SQLite (PostgreSQL's `?` is a
// jsonb operator), `$1` on PostgreSQL. Strings, comments, quoted names and dollar quotes never hold
// one, and `::type` is a cast. Each is filled from a prompt: a number stays a number, NULL is
// NULL, `=` starts an SQL expression written as is, anything else is a string quoted for the
// dialect. Pure.

import { NUMBER } from "../edit/values.js";
import { tokenize } from "../sql/lexer.js";
import { quoteText } from "../sql/quote.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {{ key: string, label: string, start: number, end: number }} Param
 *   `key` is the same for every use of one name (`:id` twice is asked once); each `?` is its own.
 */

/**
 * The parameters of `text`, in order.
 * @param {string} text
 * @param {Dialect} dialect
 * @returns {Param[]}
 */
export function paramsOf(text, dialect) {
  const tokens = tokenize(text, dialect);
  /** @type {Param[]} */
  const out = [];
  let positional = 0;
  tokens.forEach((token, i) => {
    if (token.type !== "param") return;
    const before = tokens[i - 1];
    const cast = before?.type === "op" && before.text === ":";
    if (token.text === "?") {
      if (dialect === "postgresql") return;
      positional++;
      out.push({
        key: `?${positional}`,
        label: `parameter ${positional}`,
        start: token.start,
        end: token.end,
      });
    } else if (token.text.startsWith(":") && !cast) {
      out.push({ key: token.text, label: token.text, start: token.start, end: token.end });
    } else if (token.text.startsWith("$") && dialect === "postgresql") {
      out.push({ key: token.text, label: token.text, start: token.start, end: token.end });
    }
  });
  return out;
}

/** The distinct parameters to ask for, in the order they first appear. */
export function asked(/** @type {Param[]} */ params) {
  const seen = new Set();
  return params.filter((p) => !seen.has(p.key) && seen.add(p.key));
}

/**
 * A typed answer as SQL.
 * @param {Dialect} dialect
 * @param {string} typed
 */
export function valueSql(dialect, typed) {
  if (typed.startsWith("=")) return typed.slice(1).trim();
  if (/^null$/iu.test(typed.trim())) return "NULL";
  if (NUMBER.test(typed.trim())) return typed.trim();
  return quoteText(dialect, typed);
}

/**
 * `text` with each parameter replaced by its value's SQL.
 * @param {string} text
 * @param {Param[]} params
 * @param {Record<string, string>} values SQL by key, from valueSql.
 */
export function fill(text, params, values) {
  let out = "";
  let at = 0;
  for (const param of params) {
    const value = values[param.key];
    if (value === undefined) throw new Error(`No value for ${param.label}.`);
    out += text.slice(at, param.start) + value;
    at = param.end;
  }
  return out + text.slice(at);
}
