// A statement's document by the style (ADR 0292): each clause on a line of its own (or the whole
// statement on one line when it fits and the style says so), a clause's list one item a line when
// it does not fit, conditions broken at AND and OR, joins on their own lines, subqueries, lists in
// brackets and CASE indented when they do not fit, everything else wrapping at the line width. Only
// the space between tokens is chosen here: a token is written as roles.js says, and two tokens that
// touched still touch unless one is a comma, a bracket or an operator between two operands. Pure.
import {
  casesOf,
  clausesOf,
  conditionsOf,
  isCase,
  isQuery,
  punctOf,
  QUERY_STARTS,
  splitAt,
} from "./clauses.js";
import { align, fill, group, HARD, indent, LINE, print, SOFT, SP } from "./doc.js";
import { keywordOf } from "./roles.js";
import { isParen } from "./tokens.js";

/**
 * @typedef {import("./doc.js").Doc} Doc
 * @typedef {import("./tokens.js").Token} Token
 * @typedef {import("./clauses.js").Node} Node
 * @typedef {import("./clauses.js").Case} Case
 * @typedef {import("./clauses.js").Clause} Clause
 * @typedef {import("./tokens.js").Paren & { items: Node[] }} Group
 * @typedef {{ style: import("./style.js").Style, kind: string, elements: Token | null }} Context
 *   `kind` is the statement's node kind; `elements` the bracket that opens CREATE TABLE's columns.
 */

const QUERY_KINDS = new Set(["SelectStmt", "InsertStmt", "UpdateStmt", "DeleteStmt", "MergeStmt"]);
const QUERY_AFTER_AS = new Set(["ViewStmt", "CreateTableAsStmt", "PrepareStmt"]);

const firstOf = (/** @type {Node} */ node) =>
  isCase(node)
    ? /** @type {Case} */ (node).case
    : isParen(node)
      ? /** @type {Group} */ (node).open
      : /** @type {Token} */ (node);
/** @returns {Token} */
const lastOf = (/** @type {Node} */ node) => {
  if (isCase(node)) return /** @type {Case} */ (node).end ?? /** @type {Case} */ (node).case;
  if (isParen(node)) return /** @type {Group} */ (node).close ?? /** @type {Group} */ (node).open;
  return /** @type {Token} */ (node);
};

/** The space between two tokens on one line: a space, or nothing when they stay touching. */
function gap(/** @type {Token} */ a, /** @type {Token} */ b) {
  if (b.lead.length > 0 || a.trail.length > 0) return SP;
  if (a.class === "punct" && (a.text === "(" || a.text === "[")) return "";
  if (b.class === "punct" && [")", "]", ",", ";"].includes(b.text)) return "";
  if (a.class === "punct" && (a.text === "," || a.text === ";")) return SP;
  if (a.binary || b.binary) return SP;
  return b.touched ? "" : SP;
}

/** A token with the comments attached to it: one on a line of its own stays on its own line. */
function tokenDoc(/** @type {Token} */ token) {
  if (token.lead.length === 0 && token.trail.length === 0) return token.out;
  /** @type {Doc[]} */
  const parts = [];
  token.lead.forEach((comment, k) => {
    const before = token.lead[k - 1];
    parts.push(k === 0 || before?.after || !before?.block ? HARD : SP, comment.text);
  });
  const lastLead = token.lead[token.lead.length - 1];
  if (lastLead) parts.push(lastLead.after || !lastLead.block ? HARD : SP);
  parts.push(token.out);
  for (const comment of token.trail) {
    parts.push(SP, comment.text);
    if (!comment.block) parts.push(HARD);
  }
  return parts;
}

/**
 * @param {Context} ctx
 */
export function createBuilder(ctx) {
  const { style } = ctx;
  const step = style.indent;
  const each = style.oneLine === "item" ? HARD : LINE;
  const clauseBreak = style.oneLine === "statement" ? LINE : HARD;

  const nodeDoc = (/** @type {Node} */ node) =>
    isCase(node)
      ? caseDoc(/** @type {Case} */ (node))
      : isParen(node)
        ? parenDoc(/** @type {Group} */ (node))
        : tokenDoc(/** @type {Token} */ (node));

  /** Items as words that wrap at the line width; items that touch stay together. */
  function wrap(/** @type {Node[]} */ items) {
    /** @type {Doc[]} */
    const parts = [];
    /** @type {Doc[]} */
    let run = [];
    items.forEach((node, i) => {
      const before = items[i - 1];
      if (before) {
        const space = gap(lastOf(before), firstOf(node));
        if (space === SP) {
          parts.push(run, indent(step, LINE));
          run = [];
        }
      }
      run.push(nodeDoc(node));
    });
    parts.push(run);
    return parts.length === 1 ? run : fill(parts);
  }

  /** A condition broken at its AND and OR; `shift` places the lines after the first. */
  function chain(
    /** @type {Node[]} */ items,
    /** @type {(op: Token) => number} */ shift,
    /** @type {Doc} */ breaks = each,
  ) {
    const parts = conditionsOf(items);
    if (parts.length === 1) return wrap(items);
    const [first, ...rest] = parts.map((p) => ({ op: p.op, doc: wrap(p.items) }));
    /** @type {Doc[]} */
    const out = [/** @type {{ doc: Doc }} */ (first).doc];
    for (const { op, doc } of rest) {
      const word = tokenDoc(/** @type {Token} */ (op));
      out.push(
        style.andOr === "before"
          ? indent(shift(/** @type {Token} */ (op)), [breaks, word, SP, doc])
          : [SP, word, indent(shift(/** @type {Token} */ (op)), [breaks, doc])],
      );
    }
    return group(out);
  }

  /** A list at its commas, the commas last or first; `breaks` between the items. */
  function list(/** @type {Node[]} */ items, /** @type {Doc} */ breaks, aligned = false) {
    const parts = splitAt(items, ",");
    /** @type {Doc[]} */
    const out = [];
    parts.forEach((part, k) => {
      const doc = chain(part.items, () => 0, LINE);
      const comma = parts[k - 1]?.mark;
      if (!comma) out.push(doc);
      else if (style.comma === "last") out.push(tokenDoc(comma), breaks, doc);
      else {
        // Flat, a comma first is still written `a, b`.
        const first = [breaks === HARD ? HARD : SOFT, tokenDoc(comma), SP];
        out.push(aligned ? indent(-2, first) : first, doc);
      }
    });
    return out;
  }

  /** What is inside a bracket: statements, a query, a list, or one expression. */
  function inner(/** @type {Group} */ paren) {
    const items = paren.items;
    if (items.some((n) => punctOf(n) === ";")) {
      const parts = splitAt(items, ";").filter((p) => p.items.length > 0 || p.mark);
      /** @type {Doc[]} */
      const out = [];
      parts.forEach((part, k) => {
        if (k > 0) out.push(clauseBreak);
        const doc = QUERY_STARTS.has(keywordOf(part.items[0]))
          ? query(part.items)
          : wrap(part.items);
        out.push(part.items.length > 0 ? doc : "", part.mark ? tokenDoc(part.mark) : "");
      });
      return out;
    }
    if (isQuery(paren)) return query(items);
    if (items.some((n) => punctOf(n) === ",")) return list(items, LINE);
    return chain(items, () => 0, LINE);
  }

  function parenDoc(/** @type {Group} */ paren) {
    const open = tokenDoc(paren.open);
    const close = paren.close ? tokenDoc(paren.close) : "";
    if (paren.items.length === 0) return [open, close];
    const forced = paren.open === ctx.elements && style.oneLine !== "statement";
    return group([open, indent(step, [SOFT, inner(paren)]), SOFT, close], forced);
  }

  function caseDoc(/** @type {Case} */ node) {
    /** @type {Node[]} */
    const subject = [];
    /** @type {Node[][]} */
    const arms = [];
    for (const n of node.items) {
      const word = keywordOf(n);
      if (word === "WHEN" || word === "ELSE") arms.push([n]);
      else (arms[arms.length - 1] ?? subject).push(n);
    }
    const head =
      subject.length > 0 ? [tokenDoc(node.case), SP, wrap(subject)] : tokenDoc(node.case);
    return group([
      head,
      indent(
        step,
        arms.map((arm) => [LINE, wrap(arm)]),
      ),
      LINE,
      node.end ? tokenDoc(node.end) : "",
    ]);
  }

  /** The flat width of a clause's head, for aligned lists and conditions. */
  const widthOf = (/** @type {Doc} */ doc) => print(doc, Number.MAX_SAFE_INTEGER).length;

  function clause(/** @type {Clause} */ c) {
    const head = wrap(c.head);
    const body = c.body;
    if (body.length === 0) return head;
    if (c.head.length === 0) return wrap(body);
    const touching =
      gap(
        lastOf(/** @type {Node} */ (c.head[c.head.length - 1])),
        firstOf(/** @type {Node} */ (body[0])),
      ) === "";
    const space = touching ? "" : SP;
    const width = style.lists === "align" ? widthOf(head) : 0;
    if (c.kind === "list" || c.kind === "from") {
      // One item stays after its head; its own brackets break when it does not fit.
      if (splitAt(body, ",").length === 1) return group([head, space, chain(body, () => 0, LINE)]);
      if (style.lists === "align")
        return group([head, space, align(list(body, each, style.comma === "first"))]);
      return group([head, indent(step, [touching ? SOFT : LINE, list(body, each)])]);
    }
    if (c.kind === "cond") {
      const shift =
        style.lists === "align"
          ? (/** @type {Token} */ op) =>
              style.andOr === "before" ? Math.max(0, width - op.out.length) : width + 1
          : () => step;
      return group([head, space, chain(body, shift)]);
    }
    if (c.kind === "join" || c.kind === "using") {
      const at = body.findIndex((n) => keywordOf(n) === "ON");
      if (at < 0) return group([head, space, wrap(body)]);
      const on = /** @type {Token} */ (body[at]);
      const condition = chain(body.slice(at + 1), () => 0);
      return group([
        head,
        space,
        wrap(body.slice(0, at)),
        indent(step, [LINE, tokenDoc(on), SP, condition]),
      ]);
    }
    if (c.kind === "with") {
      const parts = splitAt(body, ",");
      /** @type {Doc[]} */
      const out = [];
      parts.forEach((part, k) => {
        const comma = parts[k - 1]?.mark;
        if (comma && style.comma === "last") out.push(tokenDoc(comma), clauseBreak);
        else if (comma) out.push(clauseBreak === HARD ? HARD : SOFT, tokenDoc(comma), SP);
        out.push(wrap(part.items));
      });
      return group([head, space, out]);
    }
    if (c.kind === "when") return group([head, indent(step, [LINE, wrap(body)])]);
    return group([head, space, wrap(body)]);
  }

  /** A query: its clauses one a line, joins at the clause's level or indented under it. */
  function query(/** @type {Node[]} */ items) {
    /** @type {Doc[]} */
    const out = [];
    clausesOf(items).forEach((c, k) => {
      const doc = clause(c);
      if (k === 0) out.push(doc);
      else if (c.kind === "join" && style.joins === "indented")
        out.push(indent(step, [clauseBreak, doc]));
      else out.push(clauseBreak, doc);
    });
    return group(out);
  }

  /** Where the query of a statement that holds one starts (CREATE VIEW ... AS, EXPLAIN), or -1. */
  function queryAt(/** @type {Node[]} */ items) {
    const starts = (/** @type {number} */ i) => QUERY_STARTS.has(keywordOf(items[i]));
    const after = (/** @type {string} */ word) => {
      const at = items.findIndex((n, i) => keywordOf(n) === word && starts(i + 1));
      return at < 0 ? -1 : at + 1;
    };
    if (QUERY_AFTER_AS.has(ctx.kind)) return after("AS");
    if (ctx.kind === "DeclareCursorStmt") return after("FOR");
    if (ctx.kind === "ExplainStmt") return items.findIndex((_, i) => i > 0 && starts(i));
    if (ctx.kind === "RuleStmt") {
      const at = items.findIndex((n) => keywordOf(n) === "DO");
      const skip = ["ALSO", "INSTEAD"].includes(keywordOf(items[at + 1])) ? 2 : 1;
      return at >= 0 && starts(at + skip) ? at + skip : -1;
    }
    return -1;
  }

  /** The statement's document. */
  return function statement(/** @type {import("./tokens.js").Item[]} */ tree) {
    const items = casesOf(tree);
    const first = items[0];
    if (!first) return "";
    if ((QUERY_KINDS.has(ctx.kind) && QUERY_STARTS.has(keywordOf(first))) || isQuery(first))
      return query(items);
    const at = queryAt(items);
    if (at > 0) return group([wrap(items.slice(0, at)), clauseBreak, query(items.slice(at))]);
    // ALTER TABLE's actions, GRANT's privileges: a list breaks at its commas first.
    if (items.some((n) => punctOf(n) === ",")) return group(indent(step, list(items, LINE)));
    return group(wrap(items));
  };
}
