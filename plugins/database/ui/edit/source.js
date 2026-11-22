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

/** Words that make a statement write; UPDATE after FOR or KEY is a row lock (FOR NO KEY UPDATE). */
const WRITES = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "INTO", "CALL", "COPY"]);

/**
 * Whether a statement only reads, so reading its rows again after a Submit writes nothing: SELECT,
 * TABLE, VALUES or WITH, with no INSERT, UPDATE, DELETE, MERGE or SELECT INTO at any depth.
 * @param {Statement} statement
 */
export function readsOnly(statement) {
  const words = statement.tokens.filter((t) => t.type === "word").map((t) => t.text.toUpperCase());
  if (!["SELECT", "TABLE", "VALUES", "WITH"].includes(words[0] ?? "")) return false;
  return !words.some(
    (w, i) =>
      WRITES.has(w) && !(w === "UPDATE" && (words[i - 1] === "FOR" || words[i - 1] === "KEY")),
  );
}

/**
 * The names a statement reads more than once, so a column of theirs cannot be told to come from
 * one row (PG-45): every name that is not a qualifier (followed by ".") counts, at any depth, so a
 * self-join, a subquery over the same table or a column named like its table count twice; and a
 * WITH query named more than once besides its definition (a CTE read twice, or recursive) makes
 * every name repeated, since its rows may join with themselves.
 * @param {Statement} statement
 * @param {Dialect} dialect
 * @returns {(name: string) => boolean} Whether `name` (as the catalog writes it) is read twice.
 */
export function repeatedNames(statement, dialect) {
  const tokens = statement.tokens.filter((t) => t.type !== "space" && t.type !== "comment");
  /** @type {Map<string, number>} */
  const counts = new Map();
  tokens.forEach((token, i) => {
    const next = tokens[i + 1];
    if (next?.type === "op" && next.text === ".") return;
    const name =
      token.type === "word" || token.type === "name" ? nameOf(token, dialect) : undefined;
    if (name !== undefined) counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  const twice = withNames(tokens, dialect).some((name) => (counts.get(name) ?? 0) > 2);
  return (name) => twice || (counts.get(name) ?? 0) > 1;
}

/** The names a WITH defines: at the top level, each name right before AS, until the main query. */
function withNames(/** @type {Token[]} */ tokens, /** @type {Dialect} */ dialect) {
  if (tokens[0]?.type !== "word" || tokens[0].text.toUpperCase() !== "WITH") return [];
  /** @type {string[]} */
  const names = [];
  let depth = 0;
  /** @type {Token | undefined} */
  let before;
  for (const token of tokens.slice(1)) {
    if (token.type === "op" && token.text === "(") depth++;
    else if (token.type === "op" && token.text === ")") depth--;
    else if (depth === 0) {
      const word = token.type === "word" ? token.text.toUpperCase() : "";
      if (["SELECT", "TABLE", "VALUES"].includes(word)) break;
      const name = before && nameOf(before, dialect);
      if (word === "AS" && name !== undefined) names.push(name);
      before = token;
    }
  }
  return names;
}
