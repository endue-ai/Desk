// A routine body the server keeps as text (PL/pgSQL, a quoted SQL body) rewritten for a rename
// (PG-33), read with the plugin's lexer as navigation's body scan reads it (navigate/mentions.js):
// nothing in a comment changes, and a place changes only when it can name nothing else. A name in a
// string (dynamic SQL), a variable or parameter of the same name, a qualifier whose meaning cannot
// be told, another overload's call and a body in any other language are listed to check by hand
// with their line. A sequence's name in nextval's, currval's or setval's string, or cast to
// regclass, is rewritten. Pure.

import { quoteText } from "../sql/quote.js";
import { aliasAfter, applyEdits, identOf, lineAt, significant, written } from "./syntax.js";

/**
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {import("./syntax.js").Edit} Edit
 * @typedef {{ kind: "relation", relkind: string, schema: string, name: string, to: string }
 *   | { kind: "column", relkind: string, schema: string, table: string, name: string, to: string }
 *   | { kind: "function", routine: string, schema: string, name: string, args: string, overloads: number, to: string }
 *   | { kind: "type", domain: boolean, schema: string, name: string, to: string }
 *   | { kind: "schema", name: string, to: string }} Rename
 *   `relkind` is the schema cache's kind ("table", "view", ...); `args` the identity arguments.
 * @typedef {{ language: string, args?: string[], triggers?: string[], holders?: string[],
 *   elsewhere?: boolean }} BodyContext
 *   `args` the routine's parameter names; `triggers` the tables (schema.table) whose triggers run it;
 *   `holders` other relations (by name) with a column of the renamed name; `elsewhere` whether
 *   another schema holds an object of the renamed name.
 * @typedef {{ line: number, why: string }} Hand
 * @typedef {{ text: string, places: number, hand: Hand[] }} Rewritten
 */

/** Words of PL/pgSQL that follow a FROM item and are no alias. */
const PLPGSQL = new Set(
  "loop then into strict do begin end exception if elsif while perform return raise execute using returning limit".split(
    " ",
  ),
);
const SEQUENCE_CALLS = new Set(["nextval", "currval", "setval"]);

const escaped = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
/** Whether a text holds the name as a word of its own, in any case. */
export const mentions = (/** @type {string} */ text, /** @type {string} */ name) =>
  new RegExp(`(^|[^\\w$])${escaped(name)}($|[^\\w$])`, "iu").test(text);

/** The names a body declares (PL/pgSQL's DECLARE section, FOR's loop variables) and where. */
function declaredIn(/** @type {Token[]} */ sig) {
  const out = new Set();
  const at = new Set();
  let section = false;
  let depth = 0;
  for (const [i, t] of sig.entries()) {
    const w = identOf(t);
    if (t.text === "(") depth++;
    if (t.text === ")") depth--;
    if (w === "declare") section = true;
    else if (w === "begin" && depth === 0) section = false;
    else if (
      section &&
      depth === 0 &&
      (identOf(sig[i - 1]) === "declare" || sig[i - 1]?.text === ";") &&
      w
    ) {
      out.add(w);
      at.add(t.start);
    }
    if (w === "for" && identOf(sig[i + 2]) === "in" && identOf(sig[i + 1])) {
      out.add(identOf(sig[i + 1]));
      at.add(sig[i + 1]?.start);
    }
  }
  return { declared: out, at };
}

/** Words that start the part of a statement where relations are named. */
const FROM = new Set(["from", "join", "update", "into", "using"]);
/** Words that end it. */
const AFTER = new Set(
  "where on set group order limit having select returning values loop then window union except intersect".split(
    " ",
  ),
);

/** The relations a body's statements name, as `{ name, schema, alias }`, in order. */
function fromItems(/** @type {Token[]} */ sig) {
  /** @type {{ name: string, schema?: string, alias?: string }[]} */
  const out = [];
  /** Whether each parenthesis depth is in a FROM part now. */
  const open = [false];
  let depth = 0;
  for (let i = 0; i < sig.length; i++) {
    const t = /** @type {Token} */ (sig[i]);
    const w = t.type === "word" ? identOf(t) : undefined;
    if (t.text === "(") open[++depth] = false;
    if (t.text === ")") depth = Math.max(0, depth - 1);
    if (t.text === ";" || (w && AFTER.has(w))) open[depth] = false;
    if (w && FROM.has(w)) {
      open[depth] = true;
      continue;
    }
    const prev = sig[i - 1];
    if (
      !open[depth] ||
      identOf(t) === undefined ||
      !(prev?.text === "," || FROM.has(identOf(prev) ?? ""))
    )
      continue;
    if (identOf(t) === "only" || identOf(t) === "lateral") continue;
    let name = /** @type {string} */ (identOf(t));
    /** @type {string | undefined} */
    let schema;
    let last = i;
    if (sig[i + 1]?.text === "." && identOf(sig[i + 2]) !== undefined) {
      schema = name;
      name = /** @type {string} */ (identOf(sig[i + 2]));
      last = i + 2;
    }
    const a = aliasAfter(sig, last);
    const alias = a < 0 ? undefined : identOf(sig[a]);
    out.push({
      name,
      ...(schema ? { schema } : {}),
      ...(alias && !PLPGSQL.has(alias) ? { alias } : {}),
    });
    i = last;
  }
  return out;
}

/** The new text of a sequence's string (`'s.seq'`), or null when it does not name the sequence. */
function sequenceString(
  /** @type {string} */ text,
  /** @type {Rename & { kind: "relation" }} */ r,
) {
  if (!text.startsWith("'")) return null;
  const parts = text.slice(1, -1).replaceAll("''", "'").split(".");
  const fold = (/** @type {string} */ p) => (p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase());
  const [a, b] = parts.map(fold);
  if (parts.length === 1 && a === r.name) return quoteText("postgresql", written(r.to));
  if (parts.length === 2 && a === r.schema && b === r.name)
    return quoteText("postgresql", `${parts[0]}.${written(r.to)}`);
  return null;
}

/**
 * A body rewritten for a rename, how many places changed, and what to check by hand.
 * @param {string} source the body (prosrc)
 * @param {Rename} r
 * @param {BodyContext} ctx
 * @returns {Rewritten}
 */
export function rewriteBody(source, r, ctx) {
  const name = r.kind === "column" ? r.name : r.name;
  /** @type {Hand[]} */
  const hand = [];
  const flag = (/** @type {number} */ at, /** @type {string} */ why) => {
    const line = lineAt(source, at);
    if (!hand.some((h) => h.line === line && h.why === why)) hand.push({ line, why });
  };
  if (ctx.language !== "plpgsql" && ctx.language !== "sql") {
    const at = source.search(new RegExp(`(^|[^\\w$])${escaped(name)}($|[^\\w$])`, "iu"));
    if (at >= 0) flag(at, `a ${ctx.language} body: it is not read`);
    return { text: source, places: 0, hand };
  }
  const sig = significant(source);
  const { declared, at: declarations } = declaredIn(sig);
  for (const a of ctx.args ?? []) if (a) declared.add(a.toLowerCase());
  /** @type {Edit[]} */
  const edits = [];
  const put = (/** @type {Token} */ t, /** @type {string} */ insert) =>
    edits.push({ from: t.start, to: t.end, insert });
  const to = written(r.to);

  // The FROM items the body names (UPDATE's, INSERT INTO's too), each under its alias.
  const items = fromItems(sig);
  const relations = new Set(items.map((f) => f.name));
  /** @type {Map<string, string>} */
  const aliasOf = new Map(items.flatMap((f) => (f.alias ? [[f.alias, f.name]] : [])));
  const holders = (ctx.holders ?? []).filter((h) => relations.has(h));
  const table = r.kind === "column" ? r.table : "";
  const ownTrigger = (ctx.triggers ?? []).includes(`${"schema" in r ? r.schema : ""}.${table}`);
  const onlyOwn =
    ownTrigger &&
    (ctx.triggers ?? []).every((t) => t === `${"schema" in r ? r.schema : ""}.${table}`);

  for (const [i, t] of sig.entries()) {
    if (t.type === "string") {
      if (!mentions(t.text, name)) continue;
      const call = sig[i - 1]?.text === "(" && SEQUENCE_CALLS.has(identOf(sig[i - 2]) ?? "");
      const cast = sig[i + 1]?.text === ":" || identOf(sig[i + 2]) === "regclass";
      const next =
        r.kind === "relation" && r.relkind === "sequence" && (call || cast)
          ? sequenceString(t.text, r)
          : null;
      if (next) put(t, next);
      else flag(t.start, "the name is in a string (dynamic SQL?)");
      continue;
    }
    const w = identOf(t);
    const prev = sig[i - 1];
    const next = sig[i + 1];
    const qualified = prev?.text === ".";
    const q = qualified ? identOf(sig[i - 2]) : undefined;
    const qq = qualified && sig[i - 3]?.text === "." ? identOf(sig[i - 4]) : undefined;
    if (r.kind === "schema") {
      if (w === r.name && next?.text === "." && !qualified) put(t, to);
      continue;
    }
    if (w !== name || declarations.has(t.start)) continue;
    if (r.kind === "relation") {
      if (qualified) {
        if (q === r.schema && qq === undefined) put(t, to);
      } else if (declared.has(w)) flag(t.start, "a variable or parameter has the same name");
      else if (next?.text !== "." && ctx.elsewhere)
        flag(t.start, "another schema has an object of the same name");
      else if (next?.text !== "." && holders.length)
        flag(t.start, `${holders[0]} has a column of the same name`);
      else put(t, to);
    } else if (r.kind === "column") {
      if (qualified) {
        if (q === table && (qq === undefined || qq === r.schema)) put(t, to);
        else if ((q === "new" || q === "old") && onlyOwn) put(t, to);
        else if (q === "new" || q === "old") {
          if (ownTrigger) flag(t.start, "a trigger function of more than one table");
        } else if (q && aliasOf.get(q) === table) put(t, to);
        else if (q && (aliasOf.has(q) || relations.has(q))) {
          // Another FROM item's alias or relation.
        } else flag(t.start, `${q}.${name}: what ${q} is cannot be told`);
      } else if (next?.text === ".") {
        // The name qualifies something else here.
      } else if (!relations.has(table)) {
        if (ownTrigger) flag(t.start, "a bare name in a trigger function");
      } else if (declared.has(w)) flag(t.start, "a variable or parameter has the same name");
      else if (holders.length) flag(t.start, `${holders[0]} has a column of the same name`);
      else put(t, to);
    } else if (r.kind === "function") {
      if (next?.text !== "(" || (qualified && q !== r.schema)) continue;
      if (r.overloads > 1) flag(t.start, "another overload has the same name");
      else if (!qualified && ctx.elsewhere)
        flag(t.start, "another schema has a routine of the same name");
      else put(t, to);
    } else {
      if (qualified) {
        if (q === r.schema && qq === undefined) put(t, to);
      } else if (next?.text === "." || next?.text === "(") {
        // A qualifier or a call of the same name.
      } else if (declared.has(w)) flag(t.start, "a variable or parameter has the same name");
      else if (holders.length) flag(t.start, `${holders[0]} has a column of the same name`);
      else if (ctx.elsewhere) flag(t.start, "another schema has a type of the same name");
      else put(t, to);
    }
  }
  return { text: applyEdits(source, edits), places: edits.length, hand };
}
