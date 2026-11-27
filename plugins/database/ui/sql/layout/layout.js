// Format SQL for PostgreSQL (ADR 0292): a script, or the statement at a caret in it, laid out again
// by a style. Each statement is read by the server's grammar (parse.js) and scanner, its document
// built (build.js) and printed at the style's width, and then parsed again: when the new text does
// not give the same tree (locations left out), the statement keeps its own text, so a layout can
// never change what a statement means. A statement that does not parse is left as it is and named
// in the answer; so is a routine whose body is BEGIN ATOMIC (PG-35). Between statements only space
// changes: a statement a line, one blank line apart, and comments there stay as they are. It runs
// in the parse worker (worker.js). Pure over the raw parser.

import { t as messageText } from "../../strings/index.js";
import { createParse } from "../parse/parse.js";
import { createPositions } from "../parse/positions.js";
import { kindOf } from "../parse/tree.js";
import { createBuilder } from "./build.js";
import { print } from "./doc.js";
import { markRoles } from "./roles.js";
import { styleOf } from "./style.js";
import { bracketsOf, tokensOf } from "./tokens.js";

/**
 * @typedef {import("../parse/wasm.js").RawParser} RawParser
 * @typedef {import("../parse/parse.js").ParsedStatement} ParsedStatement
 * @typedef {{ line: number, column: number, message: string }} Left
 * @typedef {{ from: number, to: number, text: string, laid: number, left: Left[], kept: number, refused: number }} Laid
 *   `from` and `to` are the offsets of the text replaced (the whole script, or the statement at the
 *   caret); `left` the statements that do not parse; `kept` the routine bodies left as they are;
 *   `refused` the layouts the check refused (a bug when it is not 0).
 * @typedef {{ text: string } | { left: Left } | { kept: true } | { refused: true }} One
 */

/** Fields of a tree that are places in the text (location, stmt_len, rexpr_list_start ...). */
const PLACE = /^(?:stmt_len|(?:\w+_)?(?:location|list_start|list_end))$/u;

/** The tree without its places, for comparing two parses of the same statement. */
export function shapeOf(/** @type {unknown} */ tree) {
  return JSON.stringify(tree, (key, value) => (PLACE.test(key) ? undefined : value));
}

/** Whether a statement is a routine whose body is BEGIN ATOMIC ... END. */
function atomic(/** @type {Record<string, any> | null} */ tree) {
  const body = tree?.CreateFunctionStmt?.sql_body;
  return body !== undefined && kindOf(body) !== "ReturnStmt";
}

/** The bracket that opens CREATE TABLE's (or CREATE TYPE's) list of columns, if there is one. */
function elementsOf(
  /** @type {Record<string, any>} */ tree,
  /** @type {import("./tokens.js").Token[]} */ tokens,
) {
  const has =
    tree.CreateStmt?.tableElts ??
    tree.CreateForeignTableStmt?.base?.tableElts ??
    tree.CompositeTypeStmt?.coldeflist;
  if (!has) return null;
  return tokens.find((t) => t.class === "punct" && t.text === "(") ?? null;
}

/** The statement at the caret: the one it is in, else the one before it on its line, else the next. */
function statementAt(
  /** @type {ParsedStatement[]} */ statements,
  /** @type {number} */ caret,
  /** @type {string} */ sql,
) {
  const inside = statements.find((s) => caret >= s.start.offset && caret <= s.end.offset);
  if (inside) return inside;
  const lineStart = sql.lastIndexOf("\n", caret - 1) + 1;
  const before = [...statements]
    .reverse()
    .find((s) => s.end.offset <= caret && s.end.offset >= lineStart);
  return before ?? statements.find((s) => s.start.offset >= caret) ?? statements.at(-1);
}

/** The space between two statements: their semicolons, then one blank line; comments as they are. */
function between(/** @type {string} */ gap, /** @type {boolean} */ last) {
  if (gap.includes("--") || gap.includes("/*")) return gap;
  const marks = gap.replace(/\s+/gu, "");
  if (!last) return `${marks}\n\n`;
  return /\n\s*$/u.test(gap) ? `${marks}\n` : marks;
}

/**
 * @param {RawParser} raw
 * @returns {(sql: string, style?: unknown, options?: { at?: number }) => Laid}
 */
export function createLayout(raw) {
  const parse = createParse(raw);

  /** One statement of `sql` laid out, or why it stays as it is. */
  const one = (
    /** @type {string} */ sql,
    /** @type {ParsedStatement} */ statement,
    /** @type {import("./style.js").Style} */ style,
  ) => {
    /** @type {One} */
    let answer;
    if (statement.error || !statement.tree) {
      const at = statement.error?.position ?? statement.start;
      const message =
        statement.error?.message ?? messageText("sql.layout.layout.theStatementDoesNotParse");
      answer = { left: { line: at.line, column: at.column, message } };
    } else if (atomic(statement.tree)) answer = { kept: true };
    else {
      const text = sql.slice(statement.start.offset, statement.end.offset);
      const scanned = raw.scan(text);
      if ("error" in scanned) return /** @type {One} */ ({ refused: true });
      const tokens = tokensOf(text, scanned.tokens);
      markRoles(tokens, statement.tree, statement.start.byte, style);
      const kind = statement.kind ?? "";
      const build = createBuilder({ style, kind, elements: elementsOf(statement.tree, tokens) });
      const laid = print(build(bracketsOf(tokens)), style.lineWidth).trim();
      answer = same(laid, statement.tree) ? { text: laid } : { refused: true };
    }
    return answer;
  };

  /** Whether `text` parses to `tree`, places aside. */
  const same = (/** @type {string} */ text, /** @type {unknown} */ tree) => {
    const again = raw.parse(text);
    if (!("tree" in again)) return false;
    const stmts = again.tree.stmts ?? [];
    return stmts.length === 1 && shapeOf(stmts[0]?.stmt) === shapeOf(tree);
  };

  return (sql, given, options = {}) => {
    const style = styleOf(given);
    const parsed = parse(sql, createPositions(sql));
    const statements = parsed.statements;
    /** @type {Laid} */
    const done = { from: 0, to: sql.length, text: sql, laid: 0, left: [], kept: 0, refused: 0 };
    const count = (/** @type {One} */ answer) => {
      if ("text" in answer) done.laid++;
      else if ("left" in answer) done.left.push(answer.left);
      else if ("kept" in answer) done.kept++;
      else done.refused++;
      return "text" in answer ? answer.text : null;
    };
    if (options.at !== undefined) {
      const target = statementAt(statements, options.at, sql);
      if (!target) return { ...done, to: 0, text: "" };
      const text = count(one(sql, target, style));
      done.from = target.start.offset;
      done.to = target.end.offset;
      done.text = text ?? sql.slice(done.from, done.to);
      return done;
    }
    const texts = statements.map((s) => count(one(sql, s, style)));
    let out = sql.slice(0, statements[0]?.start.offset ?? sql.length);
    statements.forEach((s, i) => {
      out += texts[i] ?? sql.slice(s.start.offset, s.end.offset);
      const next = statements[i + 1];
      const gap = sql.slice(s.end.offset, next ? next.start.offset : sql.length);
      const laid = texts[i] !== null && (!next || texts[i + 1] !== null);
      out += laid ? between(gap, !next) : gap;
    });
    done.text = out;
    return done;
  };
}
