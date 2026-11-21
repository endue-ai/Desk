// The structure of one level of a statement (ADR 0292): CASE ... END spans as one item, a query's
// clauses where the grammar starts them (SELECT, FROM and its joins, WHERE, GROUP BY, ..., the
// heads of INSERT, UPDATE, DELETE and MERGE, ON CONFLICT, RETURNING, MERGE's WHEN), and the parts
// of a list at its commas and of a condition at its AND and OR. A word starts a clause only where
// it is a keyword at that level and in the place the grammar gives it: FROM after IS DISTINCT, the
// SET of a CTE's SEARCH clause, MERGE's own INSERT and UPDATE never do. Pure.
import { keywordOf } from "./roles.js";
import { isParen } from "./tokens.js";

/**
 * @typedef {import("./tokens.js").Token} Token
 * @typedef {import("./tokens.js").Paren} Paren
 * @typedef {{ case: Token, items: Node[], end: Token | null }} Case
 * @typedef {Token | (Paren & { items: Node[] }) | Case} Node
 * @typedef {"list" | "cond" | "from" | "join" | "plain" | "setop" | "with" | "when" | "using"} Kind
 * @typedef {{ kind: Kind, head: Node[], body: Node[] }} Clause
 */

export const QUERY_STARTS = new Set([
  "SELECT",
  "WITH",
  "VALUES",
  "TABLE",
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
]);
const VERBS = new Set([...QUERY_STARTS].filter((w) => w !== "WITH"));
const JOIN_WORDS = new Set(["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL", "OUTER"]);
const SETOPS = new Set(["UNION", "INTERSECT", "EXCEPT"]);
const PLAIN = new Set(["LIMIT", "OFFSET", "FETCH", "OVERRIDING"]);
const LOCKS = new Set(["UPDATE", "SHARE", "NO", "KEY"]);
const VIEW_TAILS = new Set(["CHECK", "LOCAL", "CASCADED", "NO", "DATA"]);

export const isCase = (/** @type {unknown} */ node) =>
  !!node && typeof node === "object" && "case" in node;

/** A token's text when it is punctuation, else "". */
export const punctOf = (/** @type {unknown} */ node) => {
  const token = /** @type {Token} */ (node);
  return token && "class" in token && token.class === "punct" ? token.text : "";
};

/** Whether a bracket group holds a query: its first item starts one, or is a group that does. */
export function isQuery(/** @type {Node | undefined} */ node) {
  let at = node;
  while (at && isParen(at)) {
    const paren = /** @type {Paren} */ (at);
    if (paren.open.text !== "(") return false;
    const first = paren.items[0];
    if (QUERY_STARTS.has(keywordOf(first))) return true;
    at = first;
  }
  return false;
}

/** The items with each CASE ... END at this level (and inside groups) made one item. */
export function casesOf(/** @type {import("./tokens.js").Item[]} */ items) {
  /** @type {Node[]} */
  const root = [];
  /** @type {Case[]} */
  const open = [];
  for (const item of items) {
    const node = isParen(item)
      ? { .../** @type {Paren} */ (item), items: casesOf(/** @type {Paren} */ (item).items) }
      : /** @type {Token} */ (item);
    const word = keywordOf(node);
    const into = open[open.length - 1]?.items ?? root;
    if (word === "CASE") {
      const made = { case: /** @type {Token} */ (node), items: [], end: null };
      into.push(made);
      open.push(made);
    } else if (word === "END" && open.length > 0) {
      /** @type {Case} */ (open.pop()).end = /** @type {Token} */ (node);
    } else into.push(node);
  }
  return root;
}

/** How many items from `i` make the head of the clause the keyword there starts. */
function headLength(/** @type {Node[]} */ items, /** @type {number} */ i) {
  const word = (/** @type {number} */ k) => keywordOf(items[i + k]);
  const first = word(0);
  if (first === "SELECT") {
    if (word(1) === "ALL") return 2;
    if (word(1) !== "DISTINCT") return 1;
    return word(2) === "ON" && isParen(items[i + 3]) ? 4 : 2;
  }
  if ((first === "INSERT" || first === "MERGE") && word(1) === "INTO") return 2;
  if (first === "DELETE" && word(1) === "FROM") return 2;
  if (first === "GROUP" || first === "ORDER")
    return word(2) === "ALL" || word(2) === "DISTINCT" ? 3 : 2;
  if (first === "WITH" && word(1) === "RECURSIVE") return 2;
  if (SETOPS.has(first)) return word(1) === "ALL" || word(1) === "DISTINCT" ? 2 : 1;
  if (first === "ON" || first === "DEFAULT") return 2;
  if (first === "DO") return word(1) === "UPDATE" && word(2) === "SET" ? 3 : 2;
  if (first === "WHEN") {
    const then = items.findIndex((n, k) => k > i && keywordOf(n) === "THEN");
    return then < 0 ? 1 : then - i + 1;
  }
  if (JOIN_WORDS.has(first)) {
    let k = 0;
    while (JOIN_WORDS.has(word(k))) k++;
    return k;
  }
  return 1;
}

/** Whether the keyword at `i` starts a join: a run of join words that ends in JOIN. */
function joinAt(/** @type {Node[]} */ items, /** @type {number} */ i) {
  if (!JOIN_WORDS.has(keywordOf(items[i])) || JOIN_WORDS.has(keywordOf(items[i - 1]))) return false;
  return keywordOf(items[i + headLength(items, i) - 1]) === "JOIN";
}

/** The clause a query's first item starts, and the query's verb. */
function opening(/** @type {Node[]} */ items, /** @type {number} */ i) {
  const word = keywordOf(items[i]);
  if (word === "SELECT" || word === "VALUES")
    return { kind: /** @type {Kind} */ ("list"), verb: word };
  if (isQuery(items[i])) return { kind: /** @type {Kind} */ ("plain"), verb: "SELECT" };
  return { kind: /** @type {Kind} */ ("plain"), verb: word };
}

/**
 * The clauses of a query's items: each clause's kind, its head keywords and its body.
 * @param {Node[]} items
 * @returns {Clause[]}
 */
export function clausesOf(items) {
  /** @type {Array<[number, Kind]>} */
  const starts = [];
  let verb = "";
  let current = "";
  let withOpen = false;
  let bodyClosed = false;
  let afterSetop = false;
  let skip = 0;
  const begin = (/** @type {number} */ i, /** @type {Kind} */ kind) => {
    starts.push([i, kind]);
    // Nothing inside a head starts a clause: DELETE FROM's FROM, the condition of MERGE's WHEN.
    skip = i + (kind === "plain" && isQuery(items[i]) ? 1 : headLength(items, i));
    current = kind === "join" ? "JOIN" : keywordOf(items[i]) || "(";
    afterSetop = kind === "setop";
  };
  const open = (/** @type {number} */ i) => {
    const first = opening(items, i);
    verb = first.verb;
    begin(i, first.kind);
  };
  for (let i = 0; i < items.length; i++) {
    const node = /** @type {Node} */ (items[i]);
    const word = keywordOf(node);
    const prev = keywordOf(items[i - 1]);
    const next = keywordOf(items[i + 1]);
    if (i > 0 && i < skip) continue;
    if (i === 0) {
      if (word === "WITH") {
        withOpen = true;
        begin(i, "with");
      } else open(i);
      continue;
    }
    if (withOpen) {
      if (isQuery(node) && (prev === "AS" || prev === "MATERIALIZED")) bodyClosed = true;
      else if (punctOf(node) === ",") bodyClosed = false;
      else if (bodyClosed && (VERBS.has(word) || isQuery(node))) {
        withOpen = false;
        open(i);
      }
      continue;
    }
    if (afterSetop && (VERBS.has(word) || isQuery(node))) {
      begin(i, word === "SELECT" || word === "VALUES" ? "list" : "plain");
      continue;
    }
    if (verb === "MERGE" && current === "WHEN") {
      if (word === "WHEN") begin(i, "when");
      else if (word === "RETURNING") begin(i, "list");
      continue;
    }
    if (SETOPS.has(word)) begin(i, "setop");
    else if (word === "SELECT") begin(i, "list");
    else if (word === "VALUES" && verb === "INSERT" && prev !== "DEFAULT") begin(i, "list");
    else if (word === "DEFAULT" && next === "VALUES" && verb === "INSERT") begin(i, "plain");
    else if (word === "INTO" && verb === "SELECT" && current === "SELECT") begin(i, "plain");
    else if (word === "FROM" && prev !== "DISTINCT") begin(i, "from");
    else if (word === "WHERE" || word === "HAVING") begin(i, "cond");
    else if ((word === "GROUP" || word === "ORDER") && next === "BY") begin(i, "list");
    else if (word === "WINDOW" || word === "RETURNING") begin(i, "list");
    else if (PLAIN.has(word)) begin(i, "plain");
    else if (word === "FOR" && LOCKS.has(next)) begin(i, "plain");
    else if (word === "WITH" && VIEW_TAILS.has(next)) begin(i, "plain");
    else if (word === "ON" && next === "CONFLICT") begin(i, "plain");
    else if (word === "DO" && verb === "INSERT") begin(i, next === "UPDATE" ? "list" : "plain");
    else if (word === "SET" && verb === "UPDATE" && current === "UPDATE") begin(i, "list");
    else if (word === "USING" && verb === "DELETE") begin(i, "from");
    else if (word === "USING" && verb === "MERGE") begin(i, "using");
    else if (word === "WHEN" && verb === "MERGE") begin(i, "when");
    else if (["FROM", "JOIN", "USING"].includes(current) && joinAt(items, i)) begin(i, "join");
  }
  return starts.map(([at, kind], k) => {
    const end = starts[k + 1]?.[0] ?? items.length;
    const head = kind === "plain" && isQuery(items[at]) ? 0 : headLength(items, at);
    return { kind, head: items.slice(at, at + head), body: items.slice(at + head, end) };
  });
}

/** Items split at a punctuation mark of this level, each part with the mark that ends it. */
export function splitAt(/** @type {Node[]} */ items, /** @type {string} */ mark) {
  /** @type {Array<{ items: Node[], mark: Token | null }>} */
  const parts = [{ items: [], mark: null }];
  for (const node of items) {
    const last = /** @type {{ items: Node[], mark: Token | null }} */ (parts[parts.length - 1]);
    if (punctOf(node) === mark) {
      last.mark = /** @type {Token} */ (node);
      parts.push({ items: [], mark: null });
    } else last.items.push(node);
  }
  return parts;
}

/**
 * A condition's parts at its AND and OR (not BETWEEN's AND), each with the operator before it.
 * @param {Node[]} items
 */
export function conditionsOf(items) {
  /** @type {Array<{ op: Token | null, items: Node[] }>} */
  const parts = [{ op: null, items: [] }];
  let between = false;
  for (const node of items) {
    const word = keywordOf(node);
    if (word === "BETWEEN") between = true;
    if ((word === "AND" && !between) || word === "OR") {
      parts.push({ op: /** @type {Token} */ (node), items: [] });
      continue;
    }
    if (word === "AND") between = false;
    /** @type {{ items: Node[] }} */ (parts[parts.length - 1]).items.push(node);
  }
  return parts.filter((p, i) => i === 0 || p.items.length > 0 || p.op);
}
