// PostgreSQL completion in the parse worker (ADR 0327): the statement at the caret completed by
// complete.js over the schema model as the script before it left it (the problems check's state,
// diagnose/check.js), with what is in scope answered by the resolver itself (sql/parse/, PG-05): the
// word being typed becomes a placeholder name, the statement is parsed, mended when it does not
// parse yet (its tail cut back from the error, parentheses closed, a JOIN given its ON), and bound;
// the resolver says which scope it met the placeholder in. CTEs, subqueries, set-returning
// functions and correlated levels come with it. When the statement cannot be mended, the FROM items
// read from the tokens answer instead. Pure but for the parser.

import { searchPathOf } from "../diagnose/script.js";
import { tokenize } from "../sql/lexer.js";
import { createPositions } from "../sql/parse/positions.js";
import { flat } from "../sql/parse/query.js";
import { resolve } from "../sql/parse/resolve.js";
import { t as messageText } from "../strings/index.js";
import { argsOf, builtinsOf } from "./builtins.js";
import { complete } from "./complete.js";
import { modelView } from "./model-view.js";
import { bodyCompletion } from "./plpgsql-complete.js";

/**
 * @typedef {import("../sql/parse/model.js").ModelIndex} ModelIndex
 * @typedef {import("../sql/parse/scope.js").Scope} Scope
 * @typedef {import("../sql/parse/scope.js").Entry} ScopeEntry
 * @typedef {import("../sql/parse/scope.js").Probe} Probe
 * @typedef {import("./complete.js").Hit} Hit
 * @typedef {import("./complete.js").SchemaView} SchemaView
 * @typedef {import("./joins.js").Entry} Entry
 * @typedef {import("./joins.js").Column} Column
 * @typedef {{
 *   doc: string, sql: string, caret: number, offset: number, searchPath?: string[], user?: string,
 *   picks?: import("./rank.js").Picks, want?: "items" | "signature" | "star",
 *   snippets?: import("./snippets.js").Snippet[],
 * }} CompleteRequest
 *   `sql` is the statement around the caret, `caret` in it, `offset` where it starts in the script.
 */

export const PLACEHOLDER = messageText("editor.statement.deskCaret");
/** Parses one completion may try before it falls back to the tokens. */
const ATTEMPTS = 16;
const WORD = /[A-Za-z0-9_$\u0080-￿]/u;

/** The `)` a text leaves open. */
function closers(/** @type {string} */ text) {
  let depth = 0;
  for (const t of tokenize(text, "postgresql"))
    if (t.type === "op" && t.text === "(") depth++;
    else if (t.type === "op" && t.text === ")") depth = Math.max(0, depth - 1);
  return ")".repeat(depth);
}

/** A routine's result as the columns it returns, named `name` when it returns one value. */
function resultColumns(
  /** @type {string} */ result,
  /** @type {string} */ name,
  /** @type {SchemaView} */ view,
) {
  const table = /^TABLE\s*\((.*)\)$/isu.exec(result.trim());
  if (table)
    return argsOf(table[1] ?? "").map((arg) => {
      const [col = "", ...type] = arg.trim().split(/\s+/u);
      return { name: col.replace(/^"|"$/gu, ""), type: type.join(" ") };
    });
  const setof = /^SETOF\s+(.+)$/isu.exec(result.trim());
  const of = (setof?.[1] ?? result).trim();
  const parts = of.split(".");
  const schemas = parts.length > 1 ? [parts[0] ?? ""] : (view.path ?? [view.defaultSchema]);
  const relation = parts.at(-1) ?? "";
  for (const s of schemas) {
    const columns = view.tables(s)?.some((t) => t.name === relation) && view.columns(s, relation);
    if (columns) return columns;
  }
  return [{ name, type: of }];
}

/** A resolver's FROM item as complete.js reads it, a set-returning function's columns from its result. */
function entryOf(/** @type {ScopeEntry} */ e, /** @type {SchemaView} */ view) {
  const name = e.name ?? "";
  const source = e.source;
  /** @type {Entry} */
  const entry = { name, columns: /** @type {Column[] | null} */ (flat(e)) };
  if (source.kind === "relation" && source.schema)
    entry.relation = { schema: source.schema, name: source.name };
  if (!entry.columns && source.kind === "function") {
    const result = source.routines[0]?.result ?? builtinsOf("postgresql", source.name)[0]?.result;
    if (result) entry.columns = resultColumns(result, name, view);
  }
  return entry;
}

/** What the probe met, as complete.js's levels, CTEs and the items before a FROM item. @returns {Hit} */
function hitOf(/** @type {NonNullable<Probe["hit"]>} */ hit, /** @type {SchemaView} */ view) {
  /** @type {Entry[][]} */
  const levels = [];
  /** @type {Entry[]} */
  const ctes = [];
  const seen = new Set();
  for (let s = /** @type {Scope | null} */ (hit.scope); s; s = s.parent) {
    levels.push(s.entries.filter((e) => e.name && !e.named).map((e) => entryOf(e, view)));
    for (const [name, cte] of s.ctes)
      if (!seen.has(name)) {
        seen.add(name);
        ctes.push({ name, columns: cte.columns });
      }
  }
  while (levels.length > 1 && levels.at(-1)?.length === 0) levels.pop();
  const before = hit.before?.filter((e) => e.name).map((e) => entryOf(e, view)) ?? null;
  return { levels, ctes, before };
}

/** @param {import("../sql/parse/wasm.js").RawParser} raw */
export function createCompleter(
  raw,
  /** @type {ReturnType<typeof import("../diagnose/check.js").createChecker>} */ checker,
) {
  /**
   * @param {CompleteRequest} request
   * @param {ModelIndex | undefined} index
   * @param {((view: SchemaView) => import("./plpgsql-complete.js").Locals) | undefined} locals
   */
  const run = (request, index, locals) => {
    const start = {
      ...(request.searchPath ? { searchPath: request.searchPath } : {}),
      ...(request.user ? { user: request.user } : {}),
    };
    const state = checker.stateAt(request.doc, request.offset, index, start);
    const base = index ?? new Map();
    const view = modelView(base, { ...state, index: state.index ?? base });
    /** @type {import("./complete.js").ScopeAt} */
    const scope = (c) => {
      if (
        c.place !== "star" &&
        c.place !== "qualified" &&
        c.place !== "table" &&
        c.place !== "expression"
      )
        return null;
      const text = c.text;
      let head;
      let tail;
      if (c.place === "star" && c.star) {
        head = text.slice(0, c.caret);
        tail = text.slice(c.caret);
      } else {
        let end = c.caret;
        while (end < text.length && WORD.test(text[end] ?? "")) end++;
        head = `${text.slice(0, c.from)}${PLACEHOLDER}`;
        tail = text.slice(end);
      }
      const at = c.place === "star" && c.star ? c.star.from : c.chain;
      const joined = c.place === "table" && c.join;
      let cut = tail;
      for (let n = 0; n < ATTEMPTS; n++) {
        const attempt = ` ${head}${cut}`;
        const body = attempt.slice(1);
        const read = raw.parse(`${attempt}${closers(body)}`);
        if (!("error" in read)) {
          return bound(` ${body}${closers(body)}`, read.tree, at);
        }
        if (joined) {
          const on = ` ${head} on true${cut}`;
          const second = raw.parse(`${on}${closers(on)}`);
          if (!("error" in second)) return bound(`${on}${closers(on)}`, second.tree, at);
        }
        if (cut === "") break;
        // Cut the tail back to the token before the error, or by one token when it is before.
        const positions = createPositions(attempt);
        const error = positions.ofCharacter(Math.max(0, read.error.cursor - 1)).offset - 1;
        const tokens = tokenize(cut, "postgresql").filter(
          (t) => t.type !== "space" && t.type !== "comment",
        );
        const into = error - head.length;
        const keep = tokens.filter((t) => t.end <= into);
        const kept = keep.length >= tokens.length ? tokens.slice(0, -1) : keep;
        cut = cut.slice(0, kept.at(-1)?.end ?? 0);
      }
      return null;
    };
    /** The resolver's scope at the placeholder in a text that parsed. */
    const bound = (
      /** @type {string} */ text,
      /** @type {any} */ tree,
      /** @type {number} */ at,
    ) => {
      const positions = createPositions(text);
      /** @type {Probe} */
      const probe = { at: positions.byteOf(at + 1) };
      const statements = (tree.stmts ?? []).map((s) => ({ kind: null, tree: s.stmt ?? {} }));
      const parsed = { version: 0, whole: true, statements };
      resolve(text, /** @type {never} */ (parsed), state.index ?? base, {
        searchPath: searchPathOf(state),
        user: state.user,
        positions,
        probe,
      });
      if (!probe.hit) return null;
      const hit = hitOf(probe.hit, view);
      const empty = hit.levels.every((l) => l.length === 0) && !hit.before?.length;
      return empty && hit.ctes.length === 0 ? null : hit;
    };
    const options = {
      scope,
      ...(request.picks ? { picks: request.picks } : {}),
      ...(request.want ? { want: request.want } : {}),
      ...(request.snippets ? { snippets: request.snippets } : {}),
      ...(locals ? { locals: locals(view) } : {}),
    };
    return complete(request.sql, request.caret, "postgresql", view, options);
  };

  return {
    /**
     * Completion at the caret; inside a PL/pgSQL body, of the SQL its statement runs as, with the
     * body's variables (plpgsql-complete.js), in the statement's offsets.
     * @param {CompleteRequest} request
     * @param {ModelIndex | undefined} index
     */
    complete(request, index) {
      const inBody = bodyCompletion(request.sql, request.caret);
      if (!inBody) return run(request, index, undefined);
      const found = run({ ...request, sql: inBody.sql, caret: inBody.caret }, index, inBody.locals);
      const d = inBody.shift;
      return {
        ...found,
        from: found.from + d,
        to: found.to + d,
        items: found.items.map((i) =>
          i.range ? { ...i, range: { from: i.range.from + d, to: i.range.to + d } } : i,
        ),
        ...(found.signature
          ? { signature: { ...found.signature, at: found.signature.at + d } }
          : {}),
      };
    },
  };
}
