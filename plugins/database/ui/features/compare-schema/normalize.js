// What two texts of SQL are compared by (PG-53, ADR 0338): their tokens, without comments and space,
// keywords and unquoted names in lower case, a quoted name that reads the same unquoted unquoted, the
// schema's own qualifier dropped (`app.people` and `people` are one name in schema app, also inside a
// `'app.people'::regclass`), a dollar-quoted body compared as SQL itself, and one pair of parentheses around the
// whole taken off. Also the names a text mentions, which is how objects depend on each other. Pure.

import { tokenize } from "../../sql/lexer.js";

const PLAIN = /^[a-z_][a-z0-9_$]*$/u;
const DOLLAR = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/u;

/** A quoted name's own text: "Big ""x""" is Big "x". */
const unquoted = (/** @type {string} */ text) => text.slice(1, -1).replaceAll('""', '"');

/** The name a token stands for, as PostgreSQL folds it; undefined when it is not one. */
export function nameOf(/** @type {import("../../sql/lexer.js").Token} */ token) {
  if (token.type === "word") return token.text.toLowerCase();
  if (token.type === "name" && token.text.startsWith('"')) return unquoted(token.text);
  return undefined;
}

/** The meaningful tokens of a text: no space, no comment, no statement end. */
function solid(/** @type {string} */ sql) {
  return tokenize(sql, "postgresql").filter(
    (t) => t.type !== "space" && t.type !== "comment" && t.type !== "end",
  );
}

/** A `'schema.name'` regclass literal without its own schema. */
function regclass(/** @type {string} */ literal, /** @type {string} */ schema) {
  const inner = literal.slice(1, -1).replaceAll("''", "'");
  const parts = inner.match(/"(?:[^"]|"")*"|[^.]+/gu) ?? [inner];
  const folded = parts.map((p) => (p.startsWith('"') ? unquoted(p) : p.toLowerCase()));
  const own = folded.length > 1 && folded[0] === schema;
  return `'${(own ? folded.slice(1) : folded).join(".")}'`;
}

/** Each token's text as it is compared. */
function words(/** @type {string} */ sql, /** @type {string} */ schema) {
  const tokens = solid(sql);
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = /** @type {import("../../sql/lexer.js").Token} */ (tokens[i]);
    const name = nameOf(t);
    // The schema's own qualifier: `app` `.` before a name.
    if (name !== undefined && name === schema && tokens[i + 1]?.text === "." && schema !== "") {
      i++;
      continue;
    }
    if (name !== undefined) {
      out.push(PLAIN.test(name) ? name : JSON.stringify(name));
      continue;
    }
    if (
      t.type === "string" &&
      tokens[i + 1]?.text === ":" &&
      /^::regclass\b/iu.test(castAt(tokens, i))
    )
      out.push(regclass(t.text, schema));
    else if (t.type === "string" && DOLLAR.test(t.text)) {
      // A routine's body is SQL too: compared the same way.
      const tag = DOLLAR.exec(t.text)?.[0] ?? "$$";
      out.push(`$$ ${norm(t.text.slice(tag.length, t.text.length - tag.length), schema)} $$`);
    } else out.push(t.text);
  }
  return out;
}

/** The cast after a token: `::regclass` when the tokens after it read so (`:` then `:regclass`). */
function castAt(
  /** @type {import("../../sql/lexer.js").Token[]} */ tokens,
  /** @type {number} */ i,
) {
  return tokens
    .slice(i + 1, i + 4)
    .map((t) => t.text)
    .join("");
}

/** Whether the first token's parenthesis closes at the last. */
function wrapped(/** @type {string[]} */ list) {
  if (list[0] !== "(" || list.at(-1) !== ")") return false;
  let depth = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    if (depth === 0 && i < list.length - 1) return false;
  }
  return true;
}

/**
 * A text as it is compared: two texts that differ only in formatting give the same.
 * @param {string} sql
 * @param {string} [schema] The schema whose qualifier is dropped.
 */
export function norm(sql, schema = "") {
  let list = words(sql, schema);
  while (wrapped(list)) list = list.slice(1, -1);
  return list.join(" ");
}

/**
 * The names a text mentions: each word and quoted name (the last part of a qualified one), and the
 * name in a `'...'::regclass` literal. What depends on what is read from these.
 * @param {string} sql
 * @returns {Set<string>}
 */
export function namesIn(sql) {
  const names = new Set();
  const tokens = solid(sql);
  for (let i = 0; i < tokens.length; i++) {
    const t = /** @type {import("../../sql/lexer.js").Token} */ (tokens[i]);
    const name = nameOf(t);
    if (name !== undefined) names.add(name);
    else if (t.type === "string" && /^::regclass\b/iu.test(castAt(tokens, i)))
      names.add(regclass(t.text, "").slice(1, -1).split(".").at(-1) ?? "");
  }
  return names;
}

/** A text with every `from.` qualifier written as `to.` (a source schema's objects moved). */
export function rebaseText(
  /** @type {string} */ sql,
  /** @type {string} */ from,
  /** @type {string} */ to,
) {
  if (from === to || from === "") return sql;
  const tokens = tokenize(sql, "postgresql");
  const quoted = `"${to.replaceAll('"', '""')}"`;
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = /** @type {import("../../sql/lexer.js").Token} */ (tokens[i]);
    const tag = t.type === "string" ? DOLLAR.exec(t.text)?.[0] : undefined;
    if (tag && t.text.endsWith(tag) && t.text.length >= tag.length * 2)
      out += `${tag}${rebaseText(t.text.slice(tag.length, t.text.length - tag.length), from, to)}${tag}`;
    else if (t.type === "string" && /^::regclass\b/iu.test(castAt(solidAfter(tokens, i), 0)))
      out += movedLiteral(t.text, from, to);
    else out += nameOf(t) === from && tokens[i + 1]?.text === "." ? quoted : t.text;
  }
  return out;
}

/** The tokens from i on without space and comments, the token at i first. */
const solidAfter = (
  /** @type {import("../../sql/lexer.js").Token[]} */ tokens,
  /** @type {number} */ i,
) => tokens.slice(i, i + 8).filter((t) => t.type !== "space" && t.type !== "comment");

/** A `'from.name'` regclass literal written as `'to.name'`. */
function movedLiteral(
  /** @type {string} */ literal,
  /** @type {string} */ from,
  /** @type {string} */ to,
) {
  const inner = literal.slice(1, -1).replaceAll("''", "'");
  const parts = inner.match(/"(?:[^"]|"")*"|[^.]+/gu) ?? [inner];
  const first = parts[0] ?? "";
  const folded = first.startsWith('"') ? unquoted(first) : first.toLowerCase();
  if (parts.length < 2 || folded !== from) return literal;
  const name = PLAIN.test(to) ? to : `"${to.replaceAll('"', '""')}"`;
  return `'${[name, ...parts.slice(1)].join(".").replaceAll("'", "''")}'`;
}
