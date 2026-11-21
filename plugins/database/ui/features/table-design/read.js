// The table form's reads (read-sql.js) turned into what it holds (PG-51): the server's facts (its
// version, types, casts, roles and index methods) and, for an existing table, its design as it is on
// the server, every part under an id of its catalog's (a column `c<attnum>`, a constraint or an
// index `k<oid>`) so an edit keeps it. `factsOf` and `designOf` are pure; `readForm` runs the reads.

import { ACTIONS } from "./model.js";
import { SERVER_READS, tableReads } from "./read-sql.js";
import { labelOf } from "./types.js";

/**
 * @typedef {(string | null)[][]} Rows
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./model.js").Key} Key
 * @typedef {import("./types.js").PgType} PgType
 * @typedef {import("./types.js").TypeFacts & {
 *   version: number, roles: string[], methods: string[],
 * }} Facts
 * @typedef {{ facts: Facts, original: Design | null, partitioned: string, partition: boolean }} Read
 *   `original` is the table as the server has it (null for a new table); `partitioned` its partition
 *   key as PostgreSQL writes it ("" when it has none); `partition` that it is a partition itself.
 */

const ACTION = /** @type {Record<string, import("./model.js").Action>} */ ({
  a: ACTIONS[0],
  r: ACTIONS[1],
  c: ACTIONS[2],
  n: ACTIONS[3],
  d: ACTIONS[4],
});
const IDENTITY = /** @type {Record<string, import("./model.js").Identity>} */ ({
  a: "always",
  d: "by default",
});
const text = (/** @type {string | null | undefined} */ v) => v ?? "";
const yes = (/** @type {string | null | undefined} */ v) => v === "true";
const json = (/** @type {string | null | undefined} */ v) => {
  try {
    const parsed = JSON.parse(v || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** A type from its catalog fields. */
const typeFrom = (
  /** @type {(string | null)[]} */ [oid, schema, name, formatted, modifiable, category, base],
) =>
  /** @type {PgType} */ ({
    oid: text(oid),
    label: labelOf(text(schema), text(name), text(formatted)),
    schema: text(schema),
    name: text(name),
    builtin: schema === "pg_catalog",
    modifiable: yes(modifiable),
    category: text(category),
    base: base && base !== "0" ? base : "",
  });

/** The server's facts from its reads' rows, by key. */
export function factsOf(/** @type {Record<string, Rows>} */ rows) {
  const casts = new Set();
  const binary = new Set();
  for (const [source, target, method] of rows.casts ?? []) {
    const key = `${text(source)}>${text(target)}`;
    casts.add(key);
    if (method === "b") binary.add(key);
  }
  /** @type {Facts} */
  const facts = {
    version: Number(rows.version?.[0]?.[0] ?? 0) || 0,
    types: (rows.types ?? []).map(typeFrom),
    casts,
    binary,
    roles: (rows.roles ?? []).map((r) => text(r[0])).filter(Boolean),
    methods: (rows.methods ?? []).map((r) => text(r[0])).filter(Boolean),
  };
  return facts;
}

/**
 * An existing table's design from its reads' rows; its columns' types join `facts.types` when the
 * list left them out (a table's row type).
 * @param {string} schema
 * @param {string} name
 * @param {Record<string, Rows>} rows
 * @param {Facts} facts
 */
export function designOf(schema, name, rows, facts) {
  const table = rows.table?.[0];
  if (!table) throw new Error(`There is no table ${schema}.${name}: it may have been dropped.`);
  /** @type {Design} */
  const design = {
    schema,
    name,
    comment: text(table[3]),
    owner: text(table[2]),
    columns: [],
    primaryKey: null,
    uniques: [],
    checks: [],
    foreignKeys: [],
    indexes: [],
    others: [],
    partition: { by: "", keys: [] },
    seq: 0,
  };
  for (const row of rows.columns ?? []) {
    const [num, col] = row;
    const type = typeFrom(row.slice(2, 9));
    if (!facts.types.some((t) => t.oid === type.oid)) facts.types.push(type);
    // attgenerated, then the default's or the generation's expression, then the comment.
    const generated = text(row[13]) === "s";
    const expression = text(row[14]);
    design.columns.push({
      id: `c${num}`,
      name: text(col),
      type: type.label,
      length: text(row[10]),
      array: yes(row[9]),
      nullable: !yes(row[11]),
      default: generated ? "" : expression,
      identity: IDENTITY[text(row[12])] ?? "",
      generated: generated ? expression : "",
      comment: text(row[15]),
    });
  }
  const byName = new Map(design.columns.map((c) => [c.name, c.id]));
  for (const row of rows.constraints ?? []) {
    const [oid, contype, conname, cols, expression, refSchema, refTable, refCols] = row;
    const id = `k${oid}`;
    const columns = json(cols).map((n) => `c${n}`);
    const kept = yes(row[10]) ? { kept: text(row[11]) } : {};
    const named = { id, name: text(conname), ...kept };
    if (contype === "p") design.primaryKey = { ...named, columns };
    else if (contype === "u") design.uniques.push({ ...named, columns });
    else if (contype === "c") design.checks.push({ ...named, expression: text(expression) });
    else if (contype === "x") design.others.push({ id, name: text(conname), kept: text(row[11]) });
    else if (contype === "f") {
      const self = yes(row[12]);
      const names = json(refCols).map(String);
      design.foreignKeys.push({
        ...named,
        columns,
        self,
        refSchema: text(refSchema),
        refTable: text(refTable),
        refColumns: self ? names.map((n) => byName.get(n) ?? "") : names,
        onDelete: ACTION[text(row[8])] ?? "NO ACTION",
        onUpdate: ACTION[text(row[9])] ?? "NO ACTION",
      });
    }
  }
  for (const row of rows.indexes ?? []) {
    const [oid, iname, method, unique, keys, predicate, kept, definition] = row;
    design.indexes.push({
      id: `k${oid}`,
      name: text(iname),
      method: text(method),
      unique: yes(unique),
      keys: json(keys).map((k) => {
        const [num, expr] = Array.isArray(k) ? k : [0, ""];
        return Number(num) > 0
          ? { column: `c${num}`, expression: "" }
          : { column: "", expression: String(expr ?? "") };
      }),
      where: text(predicate),
      concurrently: false,
      ...(yes(kept) ? { kept: text(definition) } : {}),
    });
  }
  return { design, partitioned: text(table[4]), partition: yes(table[5]), kind: text(table[1]) };
}

/**
 * Read the server's facts, and a table's design when one is named, in one catalog run.
 * @param {{ execute: import("../../catalog.js").Execute }} deps
 * @param {import("../../engines/common.js").Connection} conn
 * @param {{ schema: string, name: string } | null} table
 * @returns {Promise<Read>}
 */
export async function readForm(deps, conn, table) {
  const reads = [...SERVER_READS, ...(table ? tableReads(table.schema, table.name) : [])];
  const run = await deps.execute(conn, reads.map((r) => r.sql).join(";\n"), {
    catalog: true,
    maxRows: 20_000,
  });
  const { result } = run;
  const failed = result.error ?? result.statements.find((s) => s.error)?.error;
  if (failed) throw new Error(`Not read: ${failed.message}`);
  /** @type {Record<string, Rows>} */
  const rows = {};
  reads.forEach((read, i) => {
    rows[read.key] = result.statements[i]?.sets[0]?.rows ?? [];
  });
  const facts = factsOf(rows);
  if (!table) return { facts, original: null, partitioned: "", partition: false };
  const got = designOf(table.schema, table.name, rows, facts);
  if (got.kind !== "r" && got.kind !== "p")
    throw new Error(`${table.schema}.${table.name} is not a table: the form changes tables.`);
  return {
    facts,
    original: got.design,
    partitioned: got.partitioned,
    partition: got.partition,
  };
}
