// What the warnings of one statement read (ADR 0328): its tree, its text and tokens, the names the
// resolver bound in it, and what the statements before it left (script.js's state), with the small
// questions every rule asks: where a byte of the tree is in the statement, where a name or a token
// ends, which cached column a column reference means (its type, NOT NULL and relation), and how a
// warning is written down. Offsets are the statement's (its text without the space the parser was
// sent). Pure: it runs in the parse worker.
import { partsAt } from "../sql/parse/names.js";
import { fieldsOf, kindOf, listOf, stringOf, walk } from "../sql/parse/tree.js";
import { relationIn } from "./names.js";
import { endOf } from "./text.js";

/**
 * @typedef {import("../sql/parse/tree.js").Node} Node
 * @typedef {import("../sql/parse/scope.js").Name} Name
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {import("./script.js").State} State
 * @typedef {import("../sql/parse/wasm.js").RawParser} RawParser
 * @typedef {import("../sql/parse/model.js").IndexedRelation} IndexedRelation
 * @typedef {import("./names.js").Problem} Problem
 * @typedef {{ name: string, type: string, notNull: boolean, relation: string,
 *   found: IndexedRelation | undefined }} Column
 *   A column a reference means, as the cache has it (`type` "" when the script made it).
 * @typedef {{ tree: Node, text: string, positions: import("../sql/parse/positions.js").Positions,
 *   names: Name[], state: State, tokens: Token[], start: number, raw: RawParser }} Input
 *   `text` is what was parsed (the statement after one space); `tokens` are in script offsets and
 *   `start` is where the statement begins in the script.
 */

/** The strings of a dotted name (a ColumnRef's fields, a FuncCall's funcname). */
export const partsOf = (/** @type {unknown} */ list) =>
  listOf(list)
    .map((p) => stringOf(p))
    .filter((p) => p !== undefined);

/** The operator of an A_Expr. */
export const opOf = (/** @type {Node} */ f) => partsOf(f.name).at(-1) ?? "";

/** Whether a node is the constant NULL. */
export const isNull = (/** @type {unknown} */ node) => fieldsOf(node, "A_Const")?.isnull === true;

/** @param {Input} input */
export function warnContext(input) {
  const { text, positions, names, state, tokens, start } = input;
  /** @type {Problem[]} */
  const out = [];
  /** @type {Map<number, Name> | undefined} */
  let columns;
  const columnNames = () => {
    if (columns) return columns;
    columns = new Map();
    for (const n of names)
      if (n.kind === "column" && n.target?.kind === "column") columns.set(n.start.offset, n);
    return columns;
  };
  /** @type {Array<[string, Node]> | undefined} */
  let nodes;
  /** A byte of the parsed text as an offset in the statement. */
  const offsetOf = (/** @type {number} */ byte) => positions.at(byte).offset - 1;

  const ctx = {
    ...input,
    out,
    offsetOf,
    /** Each node of the tree in the order walk() visits it; the tree is walked once for every rule. */
    each(/** @type {(kind: string, fields: Node) => void} */ visit) {
      if (!nodes) {
        const found = /** @type {Array<[string, Node]>} */ ([]);
        walk(input.tree, (kind, f) => void found.push([kind, f]));
        nodes = found;
      }
      for (const [kind, f] of nodes) visit(kind, f);
    },
    /** The end of the token at `offset`, or of the expression it starts. */
    tokenEnd: (/** @type {number} */ offset, expression = false) =>
      endOf(tokens, start + offset, expression) - start,
    /** The end of a dotted name of `count` parts written at `offset`. */
    nameEnd(/** @type {number} */ offset, /** @type {number} */ count) {
      const spans = partsAt(text, offset + 1, Math.max(1, count));
      return spans ? /** @type {{ end: number }} */ (spans.at(-1)).end - 1 : ctx.tokenEnd(offset);
    },
    /** The statement's tokens from `offset` on, space and comments left out. */
    after(/** @type {number} */ offset) {
      return tokens.filter(
        (t) => t.start - start >= offset && t.type !== "space" && t.type !== "comment",
      );
    },
    /** The statement's tokens before `offset`, nearest first, space and comments left out. */
    before(/** @type {number} */ offset) {
      return tokens
        .filter((t) => t.end - start <= offset && t.type !== "space" && t.type !== "comment")
        .reverse();
    },
    /** The span of a RangeVar's name (its schema too) as written. */
    relationSpan(/** @type {Node} */ rv) {
      const from = offsetOf(rv.location ?? 0);
      const count = 1 + (rv.schemaname ? 1 : 0) + (rv.catalogname ? 1 : 0);
      return { from, to: ctx.nameEnd(from, count) };
    },
    /** What the cache knows of a RangeVar's relation, under the path the script set. */
    relation: (/** @type {Node} */ rv) =>
      rv?.relname ? relationIn(state, rv.schemaname ?? null, rv.relname)?.found : undefined,
    /** The cached column a ColumnRef means, or null when the model cannot tell. */
    column(/** @type {Node} */ ref) {
      if (!state.index || state.opaque) return null;
      const parts = partsOf(ref.fields);
      if (parts.length === 0 || kindOf(listOf(ref.fields).at(-1)) === "A_Star") return null;
      const at = positions.at(ref.location ?? 0).offset;
      const spans = partsAt(text, at, parts.length);
      const name = spans
        ? columnNames().get(/** @type {{ start: number }} */ (spans.at(-1)).start)
        : undefined;
      const target = name?.target;
      if (target?.kind !== "column" || target.of.kind !== "relation") return null;
      const found = relationIn(state, target.of.schema, target.of.name)?.found;
      const model = found?.columns?.get(target.name);
      return /** @type {Column} */ ({
        name: target.name,
        type: model?.type ?? "",
        notNull: model?.notNull === true,
        relation: target.of.name,
        found,
      });
    },
    /** The span of a ColumnRef as written. */
    refSpan(/** @type {Node} */ ref) {
      const from = offsetOf(ref.location ?? 0);
      return { from, to: ctx.nameEnd(from, partsOf(ref.fields).length) };
    },
    /**
     * Writes a warning down.
     * @param {string} rule
     * @param {{ from: number, to: number }} span
     * @param {string} message
     * @param {{ title: string, text: string }} [fix] replaces the span
     */
    put(rule, { from, to }, message, fix) {
      const kind = /** @type {const} */ ("warning");
      out.push({ from, to: Math.max(from, to), kind, rule, message, ...(fix ? { fix } : {}) });
    },
  };
  return ctx;
}

/** @typedef {ReturnType<typeof warnContext>} WarnContext */
