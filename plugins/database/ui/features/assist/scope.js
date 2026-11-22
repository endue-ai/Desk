// The schema Eris is sent (PG-90, ADR 0345): the tables a statement or a sentence names, then their
// neighbours by foreign key both ways, at most BUDGET.tables of them and BUDGET.chars characters,
// whole tables only. When nothing is named, the first tables by name. Each table goes by its
// qualified name, kind and comment, its columns' names, types and comments, and its foreign keys
// by names; never a default, a check, an index's or a routine's text, a row or a count. PostgreSQL's
// come from the schema cache (ADR 0285), the other engines' from the catalog's reads of the
// connection's own schema, without foreign keys. `pick` and `keepWithin` are pure.

import { RELATIONS } from "../../schema/common.js";
import { tokenize } from "../../sql/lexer.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../sql/lexer.js").Dialect} Dialect
 * @typedef {import("./payload.js").SentTable} SentTable
 * @typedef {import("./payload.js").SentSchema} SentSchema
 * @typedef {{ schema: string, name: string, kind: string, comment: string }} TableRef
 * @typedef {{ schema: string, table: string, refSchema: string, refTable: string, columns?: string[], refColumns?: string[] }} Key
 */

export const BUDGET = Object.freeze({ tables: 24, chars: 16_000 });

/** The words of a text outside its strings and comments, lowercased, quoted names unquoted. */
export function namesIn(/** @type {string} */ text, /** @type {Dialect} */ dialect) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const t of tokenize(text, dialect)) {
    if (t.type === "word") names.add(t.text.toLowerCase());
    else if (t.type === "name") names.add(t.text.slice(1, -1).replaceAll('""', '"').toLowerCase());
  }
  return names;
}

/** Whether a word names a table: its name, or the name's singular or plural. */
const names = (/** @type {Set<string>} */ words, /** @type {string} */ table) => {
  const name = table.toLowerCase();
  return (
    words.has(name) ||
    words.has(`${name}s`) ||
    (name.endsWith("s") && words.has(name.slice(0, -1))) ||
    (name.endsWith("es") && words.has(name.slice(0, -2)))
  );
};

const keyOf = (/** @type {string} */ schema, /** @type {string} */ table) => `${schema}.${table}`;

/**
 * The tables to send, in order: those named, then each one's neighbours by foreign key (the tables
 * it points at, then those pointing at it); with none named, the first `max` tables.
 * @param {TableRef[]} tables
 * @param {Key[]} keys
 * @param {Set<string>} words
 * @param {number} max
 */
export function pick(tables, keys, words, max) {
  const named = tables.filter((t) => names(words, t.name));
  if (!named.length) return tables.slice(0, max);
  const byKey = new Map(tables.map((t) => [keyOf(t.schema, t.name), t]));
  /** @type {Map<string, TableRef>} */
  const out = new Map();
  const add = (/** @type {TableRef | undefined} */ t) => {
    if (t && out.size < max) out.set(keyOf(t.schema, t.name), t);
  };
  for (const t of named) add(t);
  for (const t of named) {
    const at = keyOf(t.schema, t.name);
    for (const k of keys)
      if (keyOf(k.schema, k.table) === at) add(byKey.get(keyOf(k.refSchema, k.refTable)));
    for (const k of keys)
      if (keyOf(k.refSchema, k.refTable) === at) add(byKey.get(keyOf(k.schema, k.table)));
  }
  return [...out.values()];
}

/**
 * Whole tables, in order, within `chars` characters of JSON; `left` counts the ones that did not fit.
 * @param {SentTable[]} tables
 * @param {number} chars
 */
export function keepWithin(tables, chars) {
  /** @type {SentTable[]} */
  const kept = [];
  let used = 2;
  for (const t of tables) {
    const size = JSON.stringify(t).length + 1;
    if (used + size > chars) continue;
    kept.push(t);
    used += size;
  }
  return { tables: kept, left: tables.length - kept.length };
}

/** The schemas whose tables may be sent: PostgreSQL's listed ones, else the connection's own. */
async function schemasOf(
  /** @type {import("../../feature-host.js").Deps} */ deps,
  /** @type {Connection} */ conn,
) {
  const own = deps.catalog.snapshot(conn).defaultSchema;
  if (conn.engine !== "postgresql") return [own];
  const listed = await deps.catalog.schemas(conn, true);
  return [own, ...listed.filter((s) => s !== own)].filter((s) => listed.includes(s));
}

/**
 * The schema in scope of a text (a statement, or the sentence and the statement), cut to BUDGET.
 * @param {import("../../feature-host.js").Deps} deps
 * @param {Connection} conn
 * @param {string} text
 * @param {Dialect} dialect
 * @returns {Promise<SentSchema>}
 */
export async function schemaFor(deps, conn, text, dialect) {
  const schemas = await schemasOf(deps, conn);
  /** @type {TableRef[]} */
  const tables = [];
  for (const schema of schemas) {
    const objects = await deps.catalog.objects(conn, schema, true);
    for (const o of objects ?? [])
      if (RELATIONS.has(o.kind)) tables.push({ schema, name: o.name, kind: o.kind, comment: "" });
  }
  // PostgreSQL's cache holds the foreign keys and the comments; other engines send neither.
  const view = conn.engine === "postgresql" ? deps.catalog.status(conn) : undefined;
  /** @type {Key[]} */
  const keys = [];
  if (view)
    for (const t of tables) {
      t.comment = view.comment(t.schema, t.name) ?? "";
      for (const k of view.foreignKeys(t.schema, t.name) ?? [])
        keys.push({
          schema: t.schema,
          table: t.name,
          refSchema: k.schema,
          refTable: k.table,
          columns: k.columns,
          refColumns: k.refColumns,
        });
    }
  const picked = pick(tables, keys, namesIn(text, dialect), BUDGET.tables);
  /** @type {SentTable[]} */
  const sent = [];
  for (const t of picked) {
    const columns = await deps.catalog.columns(conn, t.schema, t.name, true).catch(() => []);
    sent.push({
      name: conn.engine === "sqlite" ? t.name : `${t.schema}.${t.name}`,
      kind: t.kind,
      ...(t.comment ? { comment: t.comment } : {}),
      columns: columns.map((c) => ({
        name: c.name,
        type: c.type,
        ...(c.comment ? { comment: c.comment } : {}),
      })),
      references: keys
        .filter((k) => k.schema === t.schema && k.table === t.name)
        .map((k) => ({
          columns: k.columns ?? [],
          table: `${k.refSchema}.${k.refTable}`,
          refColumns: k.refColumns ?? [],
        })),
    });
  }
  const kept = keepWithin(sent, BUDGET.chars);
  return { tables: kept.tables, left: tables.length - kept.tables.length, of: tables.length };
}
