// Completion inside a PL/pgSQL body (PG-35, ADR 0343), in the parse worker before PG-31's own: the
// PL/pgSQL statement at the caret is read from the body's outline and turned into the SQL the server
// would run for it (a SELECT ... INTO, PERFORM, RETURN QUERY, a FOR loop's query, an UPDATE as it
// stands; an IF's, WHILE's, RETURN's or assignment's expression as SELECT <expression>), which the
// statement completion completes as any query over the schema model. Beside its candidates come the
// variables in reach (declared before the caret in a block around it), the routine's parameters,
// the fields of a `%ROWTYPE` record after `r.`, and PL/pgSQL's statement words where a statement
// starts. Pure.

import { bodyAt } from "../sql/plpgsql/bodies.js";
import { outlineOf } from "../sql/plpgsql/outline.js";
import { ident } from "./complete.js";
import { keyOf } from "./rank.js";

/**
 * @typedef {import("./complete.js").SchemaView} SchemaView
 * @typedef {import("./rank.js").Item} Item
 * @typedef {import("./joins.js").Column} Column
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {{ items: Item[], records: Map<string, Column[]>, keywords: string[] }} Locals
 * @typedef {{ sql: string, caret: number, shift: number, locals(view: SchemaView): Locals }} BodyCompletion
 *   `sql` what the caret's statement is completed as, `caret` in it; `shift` turns its offsets
 *   into the statement's.
 */

/** The words a PL/pgSQL statement starts with, SQL's among them. */
export const STATEMENT_WORDS = (
  "ASSERT BEGIN CALL CASE CLOSE COMMIT CONTINUE DECLARE DELETE ELSE ELSIF END EXCEPTION EXECUTE " +
  "EXIT FETCH FOR FOREACH GET IF INSERT LOOP MERGE MOVE NULL OPEN PERFORM RAISE RETURN ROLLBACK " +
  "SELECT UPDATE WHILE WITH"
).split(" ");
const WORDS = new Set(STATEMENT_WORDS);
const BOUNDARIES = new Set(["BEGIN", "THEN", "ELSE", "LOOP", "DECLARE", "EXCEPTION"]);
const SQL_HEADS = new Set([
  "SELECT",
  "WITH",
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "VALUES",
  "TABLE",
  "CALL",
]);
const HEADERS = new Set(["IF", "ELSIF", "ELSEIF", "WHILE", "WHEN", "CASE", "ASSERT"]);

const word = (/** @type {Token | undefined} */ t) =>
  t?.type === "word" ? t.text.toUpperCase() : "";
const isOp = (/** @type {Token | undefined} */ t, /** @type {string} */ text) =>
  t?.type === "op" && t.text === text;

/** A table's columns by its name as written (`t` or `s.t`), along the view's path. */
function columnsOf(/** @type {SchemaView} */ view, /** @type {string[]} */ names) {
  if (names.length >= 2) return view.columns(names.at(-2) ?? "", names.at(-1) ?? "") ?? null;
  const name = names[0] ?? "";
  for (const s of view.path ?? [view.defaultSchema])
    if (view.tables(s)?.some((t) => t.name === name)) return view.columns(s, name) ?? null;
  return null;
}

/** The text from `from` with each INTO target list (not INSERT's or MERGE's) blanked, keeping offsets. */
function withoutInto(
  /** @type {Token[]} */ tokens,
  /** @type {string} */ text,
  /** @type {number} */ from,
  /** @type {number} */ caret,
) {
  let out = text;
  for (let i = 0; i < tokens.length; i++) {
    const t = /** @type {Token} */ (tokens[i]);
    const before = word(tokens[i - 1]);
    if (word(t) !== "INTO" || before === "INSERT" || before === "MERGE") continue;
    let j = i + 1;
    if (word(tokens[j]) === "STRICT") j++;
    while (j < tokens.length && (tokens[j]?.type === "word" || tokens[j]?.type === "name")) {
      j++;
      while (isOp(tokens[j], ".") && tokens[j + 1]) j += 2;
      if (!isOp(tokens[j], ",")) break;
      j++;
    }
    const start = t.start - from;
    const end = (tokens[j - 1]?.end ?? t.end) - from;
    if (caret >= t.start && caret <= end + from) return null;
    out = `${out.slice(0, start)}${" ".repeat(end - start)}${out.slice(end)}`;
  }
  return out;
}

/**
 * What to complete when `caret` is inside a PL/pgSQL body of the statement `text`, or null.
 * @param {string} text @param {number} caret
 * @returns {BodyCompletion | null}
 */
export function bodyCompletion(text, caret) {
  if (!text.includes("$")) return null;
  const body = bodyAt(text, caret);
  if (!body || caret < body.from) return null;
  const outline = outlineOf(text.slice(body.from, body.to), body.from);
  const tokens = outline.tokens.filter((t) => t.type !== "space" && t.type !== "comment");
  const inside = tokens.find((t) => t.start < caret && caret < t.end);
  const quiet = outline.tokens.find(
    (t) =>
      t.start < caret &&
      (caret < t.end || (t.type === "comment" && t.text.startsWith("--") && caret === t.end)),
  );
  if (quiet && (quiet.type === "string" || quiet.type === "comment")) return null;
  // The PL/pgSQL statement the caret is in: after the last boundary before the caret's word.
  let s = 0;
  tokens.forEach((t, i) => {
    if (t.end > caret || (t.end === caret && (t.type === "word" || t.type === "name"))) return;
    if (t.type === "end" || BOUNDARIES.has(word(t)) || (isOp(t, ">") && isOp(tokens[i - 1], ">")))
      s = i + 1;
  });
  let e = tokens.findIndex((t, i) => i >= s && t.start >= caret && t.type === "end");
  if (e < 0) e = tokens.length;
  const first = tokens[s];
  const head = word(first);
  const typing = Boolean(first && first.start < caret && first.end >= caret);
  const start = first?.start ?? caret;
  /** @type {{ from: number, to: number, select: boolean } | null} */
  let part = null;
  if (!first || first.start >= caret || typing) part = null;
  else if (SQL_HEADS.has(head))
    part = { from: start, to: tokens[e]?.start ?? body.to, select: false };
  else if (head === "PERFORM")
    part = { from: tokens[s].end, to: tokens[e]?.start ?? body.to, select: true };
  else if (
    head === "RETURN" &&
    word(tokens[s + 1]) === "QUERY" &&
    SQL_HEADS.has(word(tokens[s + 2]))
  )
    part = { from: tokens[s + 2]?.start ?? caret, to: tokens[e]?.start ?? body.to, select: false };
  else if (head === "FOR" && word(tokens[s + 2]) === "IN" && SQL_HEADS.has(word(tokens[s + 3]))) {
    const loop = tokens.findIndex((t, i) => i > s + 3 && word(t) === "LOOP");
    part = {
      from: tokens[s + 3]?.start ?? caret,
      to: loop < 0 ? body.to : (tokens[loop]?.start ?? body.to),
      select: false,
    };
  } else {
    // An expression: after the statement's word, an assignment's := or a list's last comma.
    let from = HEADERS.has(head) || WORDS.has(head) ? first.end : start;
    for (let i = s; i < tokens.length && (tokens[i]?.end ?? caret) <= caret; i++) {
      const t = tokens[i];
      const assigns = isOp(t, "=") && isOp(tokens[i - 1], ":");
      if (assigns || isOp(t, ",") || word(t) === "NEXT" || word(t) === "WHEN")
        from = t?.end ?? from;
    }
    const stop = tokens.findIndex(
      (t, i) =>
        i > s && t.start >= caret && (t.type === "end" || ["THEN", "LOOP"].includes(word(t))),
    );
    part = { from, to: stop < 0 ? body.to : (tokens[stop]?.start ?? body.to), select: true };
  }
  let sql;
  let shift;
  if (!part) {
    // A statement's first word: complete it as a statement's start.
    const from = typing && first ? first.start : caret;
    sql = text.slice(from, caret);
    shift = from;
  } else {
    const inner = tokens.filter((t) => t.start >= part.from && t.end <= part.to);
    const raw = text.slice(part.from, Math.max(part.to, caret));
    const blanked = part.select ? raw : withoutInto(inner, raw, part.from, caret);
    if (blanked === null) {
      const from =
        inside || tokens.find((t) => t.end === caret && (t.type === "word" || t.type === "name"));
      sql = `select ${text.slice(from ? from.start : caret, caret)}`;
      shift = (from ? from.start : caret) - 7;
    } else {
      sql = part.select ? `select ${blanked}` : blanked;
      shift = part.from - (part.select ? 7 : 0);
    }
  }
  const variables = outline.decls.filter((d) => d.from <= caret && caret <= d.to);
  return {
    sql,
    caret: caret - shift,
    shift,
    locals(view) {
      /** @type {Item[]} */
      const items = [];
      /** @type {Map<string, Column[]>} */
      const records = new Map();
      const name = (/** @type {string} */ n) => ident("postgresql", n);
      body.params.forEach((p, i) => {
        const label = p.name || `$${i + 1}`;
        items.push({
          label,
          kind: "parameter",
          detail: `${p.mode === "IN" ? "" : `${p.mode} `}${p.type}`,
          insert: p.name ? name(p.name) : label,
          key: keyOf("parameter", label),
        });
      });
      for (const d of variables) {
        let type = d.type;
        if (d.typeOf && d.typeOf.length >= 2) {
          const column = columnsOf(view, d.typeOf.slice(0, -1))?.find(
            (c) => c.name === d.typeOf?.at(-1),
          );
          if (column?.type) type = column.type;
        }
        const rowtype =
          d.rowtype ??
          (d.kind === "variable" && /^[\w.]+$/u.test(d.type) ? d.type.split(".") : null);
        const columns = rowtype ? columnsOf(view, rowtype) : null;
        if (columns) records.set(d.name, columns);
        items.push({
          label: d.name,
          kind: "variable",
          detail: `${type} · ${d.kind}`,
          insert: name(d.name),
          key: keyOf("variable", d.name),
        });
      }
      return { items, records, keywords: STATEMENT_WORDS };
    },
  };
}
