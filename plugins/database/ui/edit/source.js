// The one table a console's statement reads, when its rows can be changed in the grid: a plain
// SELECT ... FROM one table, without joins, grouping, DISTINCT, set operations, a second table or a
// subquery in FROM. Anything else answers undefined, and the grid stays read-only. Names are read
// the way the server reads them: a quoted name as written, an unquoted one folded to lower case on
// PostgreSQL and kept on MySQL and SQLite.

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {import("../sql/split.js").Statement} Statement
 */

const NOT_PLAIN = new Set([
  "JOIN",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "MINUS",
  "GROUP",
  "HAVING",
  "DISTINCT",
  "INTO",
  "WINDOW",
  "LATERAL",
  "PIVOT",
  "NATURAL",
  "ONLY",
]);
const AFTER_TABLE = new Set([
  "WHERE",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "FETCH",
  "FOR",
  "LOCK",
  "AS",
  "TABLESAMPLE",
]);

/**
 * @param {Statement} statement
 * @param {Dialect} dialect
 * @returns {{ schema: string | null, name: string } | undefined} `schema` null: the default one.
 */
export function sourceOf(statement, dialect) {
  /** @type {Token[]} */
  const top = [];
  let depth = 0;
  for (const token of statement.tokens) {
    if (token.type === "space" || token.type === "comment") continue;
    if (token.type === "op" && token.text === "(") depth++;
    else if (token.type === "op" && token.text === ")") depth--;
    else if (depth === 0) top.push(token);
  }
  const words = top.map((t) => (t.type === "word" ? t.text.toUpperCase() : ""));
  if (words[0] !== "SELECT" || words.some((w) => NOT_PLAIN.has(w))) return undefined;
  const from = words.indexOf("FROM");
  if (from < 0 || words.indexOf("FROM", from + 1) >= 0) return undefined;
  // FROM name [. name] [[AS] alias] then WHERE / ORDER / LIMIT ... or the end.
  let i = from + 1;
  const parts = [nameOf(top[i], dialect)];
  i++;
  if (top[i]?.type === "op" && top[i]?.text === ".") {
    parts.push(nameOf(top[i + 1], dialect));
    i += 2;
  }
  if (parts.some((p) => p === undefined)) return undefined;
  if (words[i] === "AS") i += 2;
  else if (top[i] && (top[i]?.type === "name" || (words[i] && !AFTER_TABLE.has(words[i] ?? ""))))
    i++;
  const rest = top.slice(i);
  if (rest.some((t) => t.type === "op" && t.text === ",")) return undefined;
  if (rest[0] && !AFTER_TABLE.has(rest[0].type === "word" ? rest[0].text.toUpperCase() : ""))
    return undefined;
  // A subquery in FROM leaves a "(" right after FROM, which the walk above skipped over.
  const fromToken = top[from];
  const next = statement.tokens.find(
    (t) => fromToken && t.start >= fromToken.end && t.type !== "space" && t.type !== "comment",
  );
  if (next?.type === "op" && next.text === "(") return undefined;
  const [first, second] = /** @type {string[]} */ (parts);
  return second === undefined
    ? { schema: null, name: first ?? "" }
    : { schema: first ?? "", name: second };
}

/** A name token as the server reads it, or undefined when it is not a name. */
function nameOf(/** @type {Token | undefined} */ token, /** @type {Dialect} */ dialect) {
  if (!token) return undefined;
  if (token.type === "word")
    return dialect === "postgresql" ? token.text.toLowerCase() : token.text;
  if (token.type !== "name") return undefined;
  const quote = token.text[0];
  const close = quote === "[" ? "]" : quote;
  const inner = token.text.slice(1, -1);
  return close === "]" ? inner : inner.replaceAll(`${close}${close}`, close ?? "");
}
