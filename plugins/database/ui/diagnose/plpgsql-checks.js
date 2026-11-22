// What a PL/pgSQL body that parses still gets wrong (PG-35, ADR 0343), from PL/pgSQL's own tree of
// it and the body's outline: a name used where only a variable can stand (a PL/pgSQL expression,
// or a SELECT with no FROM) that nothing declares, which the server refuses only when the line runs
// (`column "x" does not exist`); a variable declared and never used (warning `unused-variable`);
// and a statement after RETURN, RAISE EXCEPTION or an EXIT or CONTINUE without WHEN in the same
// list, which never runs (warning `unreachable-code`). A name declared in any block counts as
// declared, so nothing is told where scope could make it right. Offsets in the statement. Pure but
// for the parser.

import { listOf, stringOf, walk } from "../sql/parse/tree.js";
import { nearest } from "./text.js";

/**
 * @typedef {import("./names.js").Problem} Problem
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {{ text: string, body: import("../sql/plpgsql/bodies.js").Body,
 *   outline: import("../sql/plpgsql/outline.js").Outline, tree: Record<string, any>,
 *   raw: import("../sql/parse/wasm.js").RawParser }} Input
 */

/** Names every routine has (trigger functions' NEW, OLD and TG_* come in the tree's datums). */
const ALWAYS = new Set(["found", "sqlstate", "sqlerrm", "new", "old"]);
/** PostgreSQL's elog level ERROR: RAISE EXCEPTION, and RAISE alone in a handler. */
const ERROR = 21;

const significant = (/** @type {Token} */ t) => t.type !== "space" && t.type !== "comment";
const nameOf = (/** @type {Token} */ t) =>
  t.type === "name" ? t.text.slice(1, -1).replaceAll('""', '"') : t.text.toLowerCase();

/** Where each line of the body starts, from line 1. */
function lineStarts(/** @type {Input} */ input) {
  const { text, body } = input;
  const starts = [body.from];
  for (let i = body.from; i < body.to; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

/** Every name a routine declares: its datums, parameters, declarations and labels. */
function declared(/** @type {Input} */ input) {
  const names = new Set(ALWAYS);
  for (const d of listOf(input.tree.datums))
    for (const inner of Object.values(/** @type {object} */ (d)))
      if (inner?.refname) names.add(String(inner.refname).toLowerCase());
  for (const p of input.body.params) if (p.name) names.add(p.name.toLowerCase());
  for (const d of input.outline.decls) names.add(d.name.toLowerCase());
  for (const l of input.outline.labels) names.add(l.toLowerCase());
  return names;
}

/** The SQL an expression of the tree is read as, or null for none. */
function sqlOf(/** @type {{ query?: string, parseMode?: number }} */ expr) {
  const query = expr.query ?? "";
  const mode = expr.parseMode ?? 0;
  if (mode === 0) return query;
  if (mode === 2) return `SELECT ${query}`;
  if (mode >= 3) {
    const at = query.search(/:=|=/u);
    return at < 0 ? null : `SELECT ${query.slice(at + (query[at] === ":" ? 2 : 1))}`;
  }
  return null;
}

/** The bare names of the SELECTs with no FROM in a statement's tree. */
function bareNames(/** @type {unknown} */ tree) {
  /** @type {string[]} */
  const names = [];
  walk(tree, (kind, fields) => {
    // A name under a FROM, or under the table UPDATE, DELETE or MERGE writes, may be its column.
    if (kind === "UpdateStmt" || kind === "DeleteStmt" || kind === "MergeStmt") return false;
    if (kind === "InsertStmt" && fields.onConflictClause) return false;
    if (kind !== "SelectStmt") return;
    if (fields.fromClause) return false;
    const parts = ["targetList", "whereClause", "valuesLists", "havingClause", "limitCount"];
    for (const part of parts)
      walk(fields[part], (k, f) => {
        if (k === "SelectStmt" || k === "SubLink") return false;
        if (k !== "ColumnRef") return;
        const fieldList = listOf(f.fields);
        const name = fieldList.length === 1 ? stringOf(fieldList[0]) : undefined;
        if (name) names.push(name);
        return false;
      });
  });
  return names;
}

/** The first word token named `name` from the line `line` on, not after `.` nor before `(`. */
function tokenOf(
  /** @type {Input} */ input,
  /** @type {string} */ name,
  /** @type {number} */ from,
) {
  const tokens = input.outline.tokens.filter(significant);
  return tokens.find((t, i) => {
    if (t.start < from || (t.type !== "word" && t.type !== "name") || nameOf(t) !== name)
      return false;
    const before = tokens[i - 1];
    const after = tokens[i + 1];
    return (
      !(before?.type === "op" && before.text === ".") &&
      !(after?.type === "op" && after.text === "(")
    );
  });
}

/** Names used where only a variable can stand that nothing declares. @returns {Problem[]} */
export function undeclared(/** @type {Input} */ input) {
  const names = declared(input);
  const starts = lineStarts(input);
  /** @type {Problem[]} */
  const out = [];
  const told = new Set();
  /** @type {Array<{ expr: any, line: number }>} */
  const exprs = [];
  const visit = (/** @type {unknown} */ node, /** @type {number} */ line) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, line);
      return;
    }
    const here = /** @type {Record<string, any>} */ (node);
    const at = typeof here.lineno === "number" ? here.lineno : line;
    if (here.PLpgSQL_expr) exprs.push({ expr: here.PLpgSQL_expr, line: at });
    for (const [key, value] of Object.entries(here)) if (key !== "datums") visit(value, at);
  };
  visit(input.tree.action, 1);
  for (const { expr, line } of exprs) {
    const sql = sqlOf(expr);
    if (!sql) continue;
    const read = input.raw.parse(sql);
    if ("error" in read) continue;
    for (const name of bareNames(read.tree)) {
      if (names.has(name.toLowerCase()) || told.has(`${name}\u0000${line}`)) continue;
      const token = tokenOf(input, name, starts[line - 1] ?? input.body.from);
      if (!token) continue;
      told.add(`${name}\u0000${line}`);
      const near = nearest(name, names, (n) => n);
      out.push({
        from: token.start,
        to: token.end,
        kind: "names",
        message:
          `column "${name}" does not exist\n${name} is not a declared variable or parameter: the server ` +
          `refuses this line when it runs.${near ? `\nPerhaps you meant "${near}".` : ""}`,
      });
    }
  }
  return out;
}

/** Variables declared and never used. @returns {Problem[]} */
export function unused(/** @type {Input} */ input) {
  const tokens = input.outline.tokens.filter((t) => t.type === "word" || t.type === "name");
  /** @type {Problem[]} */
  const out = [];
  for (const d of input.outline.decls) {
    if (d.kind === "loop") continue;
    const used = tokens.some((t) => (t.start < d.at || t.start >= d.end) && nameOf(t) === d.name);
    if (used) continue;
    out.push({
      from: d.at,
      to: d.at + (tokens.find((t) => t.start === d.at)?.text.length ?? d.name.length),
      kind: "warning",
      rule: "unused-variable",
      message: `${d.name} is declared and never used.`,
    });
  }
  return out;
}

/** What a statement that ends its list is called, or "" when it lets the next run. */
function ender(/** @type {Record<string, any>} */ stmt) {
  if (stmt.PLpgSQL_stmt_return) return "RETURN";
  const raise = stmt.PLpgSQL_stmt_raise;
  if (raise && (raise.elog_level ?? 0) >= ERROR) return "RAISE EXCEPTION";
  const exit = stmt.PLpgSQL_stmt_exit;
  if (exit && !exit.cond) return exit.is_exit ? "EXIT" : "CONTINUE";
  return "";
}

/** @returns {number | undefined} */
const linenoOf = (/** @type {Record<string, any>} */ stmt) => Object.values(stmt)[0]?.lineno;

/** Statements after one that leaves their list. @returns {Problem[]} */
export function unreachable(/** @type {Input} */ input) {
  const starts = lineStarts(input);
  const tokens = input.outline.tokens.filter(significant);
  /** @type {Problem[]} */
  const out = [];
  const lists = [];
  const visit = (/** @type {unknown} */ node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      if (
        node.some(
          (n) => n && typeof n === "object" && /^PLpgSQL_stmt_/u.test(Object.keys(n)[0] ?? ""),
        )
      )
        lists.push(node);
      for (const n of node) visit(n);
      return;
    }
    for (const [key, value] of Object.entries(node)) if (key !== "datums") visit(value);
  };
  visit(input.tree.action);
  for (const list of lists) {
    const at = list.findIndex((s) => ender(s) !== "");
    const stop = at < 0 ? undefined : list[at];
    const next = list.slice(at + 1).find((s) => linenoOf(s) !== undefined);
    const line = next ? linenoOf(next) : undefined;
    if (!stop || line === undefined) continue;
    const begin = starts[line - 1] ?? input.body.from;
    const end = starts[line] ?? input.body.to;
    let first = tokens.find((t) => t.start >= begin && t.start < end);
    if (line === linenoOf(stop)) {
      const ended = tokens.find((t) => t.start >= begin && t.type === "end");
      first = ended ? tokens.find((t) => t.start >= ended.end && t.start < end) : undefined;
    }
    const semi = first && tokens.find((t) => t.start >= first.start && t.type === "end");
    const last =
      semi && semi.end <= end
        ? semi
        : tokens.filter((t) => t.start >= (first?.start ?? end) && t.end <= end).at(-1);
    if (!first || !last) continue;
    const said = ender(stop);
    out.push({
      from: first.start,
      to: last.end,
      kind: "warning",
      rule: "unreachable-code",
      message: `This never runs: the ${said} on line ${linenoOf(stop)} of the body ${
        said === "RETURN" ? "ends the routine" : said === "RAISE EXCEPTION" ? "raises" : "leaves"
      } before it.`,
    });
  }
  return out;
}
