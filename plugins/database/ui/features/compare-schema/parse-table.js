// A table read from a DDL file into PG-51's design (PG-53, ADR 0338): CREATE TABLE's columns (type,
// NOT NULL, DEFAULT, an identity, a stored generation, inline PRIMARY KEY, UNIQUE, CHECK and
// REFERENCES) and table constraints, PARTITION BY; CREATE INDEX; ALTER TABLE ... ADD a constraint;
// COMMENT ON TABLE and COLUMN. A part the table form cannot write (DEFERRABLE, INCLUDE, an index key
// with an order or an operator class) is kept as written. What it cannot read is said. Pure.

import { ACTIONS, blank } from "../table-design/model.js";
import { cursor, items, literal } from "./cursor.js";
import { typed } from "./types.js";

/**
 * @typedef {import("../table-design/model.js").Design} Design
 * @typedef {ReturnType<typeof cursor>} Cursor
 * @typedef {{ schema: string, ours: Set<string>, seq: { n: number } }} Ctx
 *   `ours` the type names the folder defines; `seq` the ids given so far.
 * @typedef {{ design: Design, partition: string, serials: { column: string, type: string }[] }} Read
 */

const COLUMN_STOP = new Set([
  "constraint",
  "not",
  "null",
  "default",
  "primary",
  "unique",
  "check",
  "references",
  "generated",
  "collate",
]);
const next = (/** @type {Ctx} */ ctx, /** @type {string} */ p) => `${p}${++ctx.seq.n}`;

/** A referential action: `ON DELETE SET NULL`. */
function action(/** @type {Cursor} */ c) {
  for (const a of ACTIONS) if (c.take(...a.toLowerCase().split(" "))) return a;
  return "NO ACTION";
}

/** The columns of a list by name, as ids of the design. */
const idsOf = (/** @type {Design} */ d, /** @type {string} */ list) =>
  items(list).map((n) => {
    const name = cursor(n).one();
    return d.columns.find((c) => c.name === name)?.id ?? "";
  });

/** REFERENCES table [(columns)] [ON DELETE ...] [ON UPDATE ...]: what follows the word. */
function references(/** @type {Cursor} */ c, /** @type {Design} */ d, /** @type {Ctx} */ ctx) {
  const ref = c.qualified();
  const cols = c.group();
  let onDelete = /** @type {import("../table-design/model.js").Action} */ ("NO ACTION");
  let onUpdate = onDelete;
  while (c.take("on")) {
    if (c.take("delete")) onDelete = action(c);
    else if (c.take("update")) onUpdate = action(c);
  }
  const refSchema = ref.schema || ctx.schema;
  const self = refSchema === d.schema && ref.name === d.name;
  const names = cols === undefined ? [] : items(cols).map((n) => cursor(n).one());
  return {
    self,
    refSchema,
    refTable: ref.name,
    refColumns: self ? names.map((n) => d.columns.find((x) => x.name === n)?.id ?? "") : names,
    onDelete,
    onUpdate,
  };
}

/**
 * A table constraint after its name: PRIMARY KEY, UNIQUE, CHECK, FOREIGN KEY, EXCLUDE; anything the
 * form cannot write is kept as written.
 */
export function addConstraint(
  /** @type {Design} */ d,
  /** @type {string} */ name,
  /** @type {string} */ text,
  /** @type {Ctx} */ ctx,
) {
  const c = cursor(text);
  const id = next(ctx, "k");
  const plain =
    !/\b(DEFERRABLE|INITIALLY|NOT\s+VALID|NO\s+INHERIT|INCLUDE|USING\s+INDEX|NULLS\s+NOT\s+DISTINCT|MATCH\s+FULL)\b/iu.test(
      text,
    );
  if (c.take("exclude") || !plain) {
    const kept = { id, name, kept: text.trim() };
    if (/^\s*primary\b/iu.test(text)) d.primaryKey = { ...kept, columns: [] };
    else if (/^\s*unique\b/iu.test(text)) d.uniques.push({ ...kept, columns: [] });
    else if (/^\s*check\b/iu.test(text)) d.checks.push({ ...kept, expression: "" });
    else d.others.push(kept);
    return;
  }
  if (c.take("primary", "key")) d.primaryKey = { id, name, columns: idsOf(d, c.group() ?? "") };
  else if (c.take("unique")) d.uniques.push({ id, name, columns: idsOf(d, c.group() ?? "") });
  else if (c.take("check")) d.checks.push({ id, name, expression: (c.group() ?? "").trim() });
  else if (c.take("foreign", "key")) {
    const columns = idsOf(d, c.group() ?? "");
    c.take("references");
    d.foreignKeys.push({ id, name, columns, ...references(c, d, ctx) });
  } else throw new Error(`a constraint it cannot read: ${text.trim()}`);
}

/** One column definition. */
function column(
  /** @type {Design} */ d,
  /** @type {string} */ text,
  /** @type {Ctx} */ ctx,
  /** @type {Read["serials"]} */ serials,
) {
  const c = cursor(text);
  const name = c.one();
  const type = typed(c.until(COLUMN_STOP), { own: ctx.schema, ours: ctx.ours });
  const id = next(ctx, "c");
  const col = {
    id,
    name,
    type: type.type,
    length: type.length,
    array: type.array,
    nullable: true,
    default: "",
    identity: /** @type {import("../table-design/model.js").Identity} */ (""),
    generated: "",
    comment: "",
  };
  d.columns.push(col);
  if (type.serial) {
    serials.push({ column: name, type: type.type });
    col.nullable = false;
    col.default = `nextval('${d.name}_${name}_seq'::regclass)`;
  }
  let named = "";
  while (!c.done) {
    if (c.take("constraint")) {
      named = c.one();
      continue;
    }
    if (c.take("not", "null")) col.nullable = false;
    else if (c.take("null")) col.nullable = true;
    else if (c.take("default")) col.default = c.until(COLUMN_STOP);
    else if (c.take("collate")) c.qualified();
    else if (c.take("primary", "key")) {
      d.primaryKey = { id: next(ctx, "k"), name: named, columns: [id] };
      col.nullable = false;
    } else if (c.take("unique")) d.uniques.push({ id: next(ctx, "k"), name: named, columns: [id] });
    else if (c.take("check"))
      d.checks.push({ id: next(ctx, "k"), name: named, expression: (c.group() ?? "").trim() });
    else if (c.take("references"))
      d.foreignKeys.push({
        id: next(ctx, "k"),
        name: named,
        columns: [id],
        ...references(c, d, ctx),
      });
    else if (c.take("generated", "always", "as", "identity")) identity(c, col, "always");
    else if (c.take("generated", "by", "default", "as", "identity")) identity(c, col, "by default");
    else if (c.take("generated", "always", "as")) {
      col.generated = (c.group() ?? "").trim();
      c.take("stored");
    } else throw new Error(`column ${name}: it cannot read ${c.rest()}`);
    named = "";
  }
}

/** An identity column: NOT NULL, its sequence's options (not compared) passed over. */
function identity(
  /** @type {Cursor} */ c,
  /** @type {import("../table-design/model.js").Column} */ col,
  /** @type {import("../table-design/model.js").Identity} */ how,
) {
  col.identity = how;
  col.nullable = false;
  c.group();
}

/** CREATE TABLE. */
export function parseTable(/** @type {string} */ text, /** @type {Ctx} */ ctx) {
  const c = cursor(text);
  c.take("create");
  while (["unlogged", "temp", "temporary"].includes(c.peek())) c.take(c.peek());
  c.take("table");
  c.take("if", "not", "exists");
  const name = c.qualified();
  const d = blank(name.schema || ctx.schema);
  d.name = name.name;
  /** @type {Read["serials"]} */
  const serials = [];
  const body = c.group() ?? "";
  for (const item of items(body)) {
    const p = cursor(item);
    let named = "";
    if (p.take("constraint")) named = p.one();
    const rest = item.slice(p.at);
    if (/^(primary|unique|check|foreign|exclude)$/u.test(p.peek()))
      addConstraint(d, named, rest, ctx);
    else if (p.peek() === "like") throw new Error("LIKE in a table it cannot read");
    else column(d, item, ctx, serials);
  }
  let partition = "";
  if (c.take("partition", "by"))
    partition = c.rest().replace(/^(range|list|hash)/iu, (m) => m.toUpperCase());
  else if (!c.done) throw new Error(`table ${d.name}: it cannot read ${c.rest()}`);
  return { design: d, partition, serials };
}

/** A key the form writes: a column, an expression in parentheses or a call, with no order. */
const plainKey = (/** @type {string} */ key) =>
  !/\b(ASC|DESC|NULLS|COLLATE)\b/iu.test(key) &&
  (/^\s*\(.*\)\s*$/su.test(key) ||
    /^\s*[\w."]+\s*\(.*\)\s*$/su.test(key) ||
    (cursor(key).one() !== "" && cursor(key).peek(1) === ""));

/** CREATE INDEX: its table, and the index (kept as written when the form cannot write it). */
export function parseIndex(/** @type {string} */ text) {
  const c = cursor(text);
  c.take("create");
  const unique = c.take("unique");
  c.take("index");
  c.take("concurrently");
  c.take("if", "not", "exists");
  const name = c.peek() === "on" ? "" : c.one();
  c.take("on");
  c.take("only");
  const table = c.qualified();
  const method = c.take("using") ? c.one() : "btree";
  const keys = items(c.group() ?? "");
  const where = c.take("where") ? c.rest() : "";
  const plain = c.done && keys.every(plainKey);
  return { table, name, method, unique, keys, where, kept: plain ? undefined : text.trim() };
}

/** An index key read: a lone name is a column, anything else an expression. */
export function keyOf(/** @type {Design} */ d, /** @type {string} */ key) {
  const k = cursor(key);
  const one = k.one();
  if (one && k.done)
    return { column: d.columns.find((x) => x.name === one)?.id ?? "", expression: "" };
  const t = key.trim();
  return {
    column: "",
    expression: t.startsWith("(") && t.endsWith(")") ? t.slice(1, -1).trim() : t,
  };
}

/** COMMENT ON TABLE t IS '...' or COMMENT ON COLUMN t.c IS '...': what and the text. */
export function parseComment(/** @type {string} */ text) {
  const c = cursor(text);
  c.take("comment", "on");
  const kind = c.take("table") ? "table" : c.take("column") ? "column" : "";
  const parts = [c.one()];
  while (c.peek() === ".") {
    c.take(".");
    parts.push(c.one());
  }
  c.take("is");
  const rest = c.rest();
  const value = /^null$/iu.test(rest) ? "" : literal(rest);
  if (kind === "column") {
    const col = /** @type {string} */ (parts.pop());
    return {
      kind,
      table: parts.at(-1) ?? "",
      schema: parts.length > 1 ? (parts[0] ?? "") : "",
      column: col,
      value,
    };
  }
  return {
    kind,
    table: parts.at(-1) ?? "",
    schema: parts.length > 1 ? (parts[0] ?? "") : "",
    column: "",
    value,
  };
}
