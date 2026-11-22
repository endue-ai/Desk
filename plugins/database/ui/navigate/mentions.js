// Where a source text names an object (PG-32): a routine body the catalog does not record (PL/pgSQL,
// a quoted SQL body) read with the plugin's lexer, so a name in a string or a comment is not one. An
// unquoted word folds to lower case as the server folds it; a quoted name is compared as written;
// a name qualified by another schema is someone else's. Pure: it runs in mentions-worker.js past
// INLINE_MAX characters and in place below.

import { tokenize } from "../sql/lexer.js";
import { identOf } from "./target.js";

/**
 * @typedef {import("./target.js").Aim} Aim
 * @typedef {{ from: number, to: number, line: number }} Mention
 *   `line` counts from 1.
 */

/** Places a text holds at most; the rest are counted, not listed. */
export const MAX_MENTIONS = 20;

/** The schema an aim lives in, when it has one. */
const schemaOf = (/** @type {Aim} */ aim) =>
  aim.kind === "relation" || aim.kind === "function" || aim.kind === "type" || aim.kind === "column"
    ? aim.schema
    : undefined;

/**
 * Where `text` names the aim, and how many places in all.
 * @param {string} text
 * @param {Aim} aim
 * @returns {{ places: Mention[], count: number }}
 */
export function mentionsOf(text, aim) {
  const want = aim.name;
  if (!text.toLowerCase().includes(want.toLowerCase())) return { places: [], count: 0 };
  const tokens = tokenize(text, "postgresql").filter(
    (t) => t.type !== "space" && t.type !== "comment",
  );
  const schema = schemaOf(aim);
  /** @type {Mention[]} */
  const places = [];
  let count = 0;
  let line = 1;
  let counted = 0;
  for (const [i, t] of tokens.entries()) {
    if (identOf(t) !== want) continue;
    if (tokens[i - 1]?.text === ".") {
      const qualifier = identOf(tokens[i - 2]);
      // `s.t` names it only in its schema; `alias.column` may name a column.
      if (aim.kind !== "column" && qualifier !== schema) continue;
    }
    count++;
    if (places.length >= MAX_MENTIONS) continue;
    for (
      let at = text.indexOf("\n", counted);
      at >= 0 && at < t.start;
      at = text.indexOf("\n", at + 1)
    ) {
      line++;
      counted = at + 1;
    }
    places.push({ from: t.start, to: t.end, line });
  }
  return { places, count };
}
