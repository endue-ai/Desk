// Extract a subquery into a CTE, and inline a CTE used once (PG-33), on one statement's text. A FROM
// item's subquery of the statement's own query or of one of its CTEs becomes a CTE under its alias,
// placed before the CTE that held it or at the end of the WITH list (a new one when there is none),
// and the FROM item names it. A CTE used once as a FROM item goes back there as a subquery under
// the use's alias (or its own name) and leaves the WITH list. What would change the result is
// refused with why: a LATERAL subquery, a subquery inside another, RECURSIVE, MATERIALIZED, a
// data-modifying CTE, a CTE used twice. Uses are what the resolver bound. Pure.

import { t as messageText } from "../strings/index.js";
import {
  aliasAfter,
  applyEdits,
  identOf,
  pairsOf,
  significant,
  withListAt,
  written,
} from "./syntax.js";

/**
 * @typedef {import("../sql/parse/scope.js").Name} Name
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {import("./syntax.js").WithList} WithList
 */

/** Words a query's body starts with: what a CTE can be without writing data. */
const QUERY = new Set(["select", "values", "table", "with"]);
/** Words that start a statement a WITH list can lead. */
const LEADS = new Set(["select", "values", "table", "insert", "update", "delete", "merge", "with"]);
/** The clause words a FROM item is told from a select list's or a condition's subquery by. */
const CLAUSES = new Set([
  "select",
  "from",
  "where",
  "group",
  "having",
  "order",
  "limit",
  "on",
  "set",
  "returning",
  "values",
  "using",
  "window",
]);

/** The statement's tokens, parentheses and leading WITH list. */
function readOf(/** @type {string} */ text) {
  const tokens = significant(text).filter((t) => t.type !== "end");
  const { close, around } = pairsOf(tokens);
  const list = withListAt(tokens, close, 0);
  return { tokens, close, around, list };
}

/** Whether the `(` at `open` starts a FROM item: the nearest clause word before it is FROM or JOIN. */
function fromItem(
  /** @type {Token[]} */ tokens,
  /** @type {number[]} */ around,
  /** @type {number} */ open,
) {
  const before = tokens[open - 1];
  if (identOf(before) === "join") return true;
  for (let i = open - 1; i >= 0; i--) {
    if (around[i] !== around[open]) continue;
    const w = tokens[i]?.type === "word" ? identOf(tokens[i]) : undefined;
    if (w === "from" || w === "join") return true;
    if (w && CLAUSES.has(w)) return false;
  }
  return false;
}

/**
 * The statement with the FROM subquery at the caret made a CTE, or why not.
 * @param {string} text
 * @param {Name[]} names its resolution (the CTEs a body names must be the statement's own)
 * @param {number} caret
 * @param {string} [given] the CTE's name when the subquery has no alias
 * @returns {{ text: string, name: string } | string}
 */
export function extractCte(text, names, caret, given) {
  const { tokens, close, around, list } = readOf(text);
  const lead = identOf(tokens[0]);
  if (!lead || !LEADS.has(lead))
    return messageText("refactor.cte.extractWorksInSelectInsertUpdate");
  let open = -1;
  for (const [o, c] of close) {
    const inside = tokens[o]?.start <= caret && caret <= (tokens[c]?.end ?? -1);
    if (
      inside &&
      QUERY.has(identOf(tokens[o + 1]) ?? "") &&
      fromItem(tokens, around, o) &&
      o > open
    )
      open = o;
  }
  if (open < 0) return messageText("refactor.cte.putTheCaretInASubquery");
  if (identOf(tokens[open - 1]) === "lateral")
    return messageText("refactor.cte.aLateralSubqueryReadsTheFrom");
  const holder = list?.entries.find((e) => e.open < open && open < e.close);
  // The subquery must sit in the statement's own query or in a CTE's, not in another subquery.
  const level = holder ? holder.open : -1;
  for (let p = around[open] ?? -1; p !== level; p = around[p] ?? -1)
    if (p < 0 || QUERY.has(identOf(tokens[p + 1]) ?? ""))
      return messageText("refactor.cte.extractWorksOnASubqueryOf");
  const shut = /** @type {number} */ (close.get(open));
  const a = aliasAfter(tokens, shut);
  const alias = a < 0 ? given : identOf(tokens[a]);
  if (!alias) return messageText("refactor.cte.nameTheSubqueryGiveItAn");
  if (list?.entries.some((e) => e.name === alias))
    return messageText("refactor.cte.isAlreadyACteOfThis", { alias: String(alias) });
  let last = a < 0 ? shut : a;
  const columns = tokens[last + 1]?.text === "(" ? close.get(last + 1) : undefined;
  const cols =
    columns === undefined ? "" : text.slice(tokens[last + 1]?.start, tokens[columns]?.end);
  if (columns !== undefined) last = columns;
  const body = text.slice(tokens[open + 1]?.start, tokens[shut - 1]?.end);
  const inner = new Set(list?.entries.map((e) => tokens[e.nameAt]?.start));
  const own = names.some(
    (n) =>
      n.target?.kind === "cte" &&
      n.start.offset > (tokens[open]?.start ?? 0) &&
      n.end.offset < (tokens[shut]?.end ?? 0) &&
      !inner.has(n.target.position.offset),
  );
  if (own) return messageText("refactor.cte.theSubqueryNamesACteOf");
  const def = `${written(alias)}${cols} AS (${body})`;
  const edits = [
    {
      from: /** @type {number} */ (tokens[open]?.start),
      to: /** @type {number} */ (tokens[last]?.end),
      insert: written(alias),
    },
  ];
  if (!list)
    edits.push({ from: tokens[0]?.start ?? 0, to: tokens[0]?.start ?? 0, insert: `WITH ${def}\n` });
  else if (holder) {
    const at = /** @type {number} */ (tokens[holder.start]?.start);
    edits.push({ from: at, to: at, insert: `${def},\n` });
  } else {
    const end = /** @type {number} */ (tokens[list.entries.at(-1)?.end ?? 0]?.end);
    edits.push({ from: end, to: end, insert: `,\n${def}` });
  }
  return { text: applyEdits(text, edits), name: alias };
}

/**
 * The statement with the CTE at `at` (its name's offset) inlined where it is used, or why not.
 * @param {string} text
 * @param {Name[]} names
 * @param {number} at
 * @returns {{ text: string, name: string } | string}
 */
export function inlineCte(text, names, at) {
  const { tokens, close } = readOf(text);
  const lists = tokens.flatMap((t, i) =>
    identOf(t) === "with" ? [withListAt(tokens, close, i)] : [],
  );
  /** @type {WithList | null} */
  let owner = null;
  let index = -1;
  for (const l of lists) {
    const i = l?.entries.findIndex((e) => tokens[e.nameAt]?.start === at) ?? -1;
    if (l && i >= 0) {
      owner = l;
      index = i;
    }
  }
  const entry = owner?.entries[index];
  if (!owner || !entry) return messageText("refactor.cte.putTheCaretOnACte");
  if (owner.recursive) return messageText("refactor.cte.aRecursiveWithListCanRead");
  if (entry.materialized === "yes")
    return messageText("refactor.cte.isMaterializedInliningWouldChangeThat", {
      name: String(entry.name),
    });
  if (entry.columns)
    return messageText("refactor.cte.renamesItsColumnsInlineItBy", { name: String(entry.name) });
  if (!QUERY.has(identOf(tokens[entry.open + 1]) ?? ""))
    return messageText("refactor.cte.writesDataOnlyAQueryCan", { name: String(entry.name) });
  const uses = names.filter(
    (n) => n.kind === "relation" && n.target?.kind === "cte" && n.target.position.offset === at,
  );
  if (uses.length !== 1)
    return uses.length === 0
      ? messageText("refactor.cte.isUsedNowhereDeleteItInstead", { name: String(entry.name) })
      : messageText("refactor.cte.isUsedTimesInlineWorksOn", {
          name: String(entry.name),
          length: String(uses.length),
        });
  const use = /** @type {Name} */ (uses[0]);
  const u = tokens.findIndex((t) => t.start === use.start.offset);
  const body = text.slice(tokens[entry.open + 1]?.start, tokens[entry.close - 1]?.end);
  const aliased = aliasAfter(tokens, u) >= 0;
  const edits = [
    {
      from: use.start.offset,
      to: use.end.offset,
      insert: `(${body})${aliased ? "" : ` AS ${written(entry.name)}`}`,
    },
  ];
  const entries = owner.entries;
  const start = (/** @type {number} */ i) => /** @type {number} */ (tokens[i]?.start);
  const end = (/** @type {number} */ i) => /** @type {number} */ (tokens[i]?.end);
  if (entries.length === 1) {
    const next = tokens[entry.end + 1];
    edits.push({ from: start(owner.at), to: next ? next.start : end(entry.end), insert: "" });
  } else if (index < entries.length - 1) {
    edits.push({
      from: start(entry.start),
      to: start(/** @type {any} */ (entries[index + 1]).start),
      insert: "",
    });
  } else {
    edits.push({
      from: end(/** @type {any} */ (entries[index - 1]).end),
      to: end(entry.end),
      insert: "",
    });
  }
  return { text: applyEdits(text, edits), name: entry.name };
}
