// A cached schema as its consumers read it: the rows each kind read (kinds.js), kept as the server
// wrote them, turned into objects (the explorer's SchemaObject), columns, parts, foreign keys and
// routine signatures; PG-50's kinds through schema/pg/ (the database level's too). Each lookup is
// built once per schema read and kept beside it. Pure.

import { lookupOf as pgLookupOf } from "../schema/pg/index.js";

/**
 * @typedef {(string | null)[]} Row
 * @typedef {{ name: string, mark: string, readAt: number, data: Record<string, Row[]> }} SchemaData
 *   `mark` is the schema's fingerprint when it was read; `data` the rows of each kind, by kind id,
 *   without the schema's name.
 * @typedef {import("../schema/common.js").SchemaObject} SchemaObject
 * @typedef {import("../schema/common.js").Part} Part
 * @typedef {import("../schema/common.js").PartKind} PartKind
 * @typedef {{ name: string, type: string, nullable: boolean, default: string | null, primary: boolean, comment: string }} Column
 * @typedef {{ name: string, columns: string[], schema: string, table: string, refColumns: string[] }} ForeignKey
 *   `schema` and `table` are the referenced table's.
 * @typedef {{ name: string, args: string, kind: "function" | "procedure", result: string, ident: string, comment: string }} Routine
 * @typedef {{
 *   objects: SchemaObject[], relations: Set<string>, columns: Map<string, Column[]>,
 *   parts: Map<string, Part[]>, foreignKeys: Map<string, ForeignKey[]>, routines: Routine[],
 *   comments: Map<string, string>,
 * }} Lookup
 *   `relations` names the schema's tables, views and sequences; `comments` holds theirs.
 */

const RELKIND = /** @type {Record<string, import("../schema/common.js").ObjectKind>} */ ({
  r: "table",
  p: "table",
  v: "view",
  m: "materialized view",
  f: "foreign table",
  S: "sequence",
});
const CONTYPE = /** @type {Record<string, PartKind>} */ ({
  p: "primary key",
  u: "unique",
  c: "check",
  f: "foreign key",
  x: "exclusion",
});
/** The explorer's order of parts: constraints by kind, then indexes, then triggers. */
const PART_ORDER = ["check", "constraint", "exclusion", "foreign key", "primary key", "unique"];

/** @type {WeakMap<SchemaData, Lookup>} */
const lookups = new WeakMap();

const text = (/** @type {string | null | undefined} */ value) => value ?? "";
const list = (/** @type {string | null | undefined} */ json) => {
  try {
    const parsed = JSON.parse(json ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};
/** @template T @param {Map<string, T[]>} map @param {string} key @param {T} value */
const add = (map, key, value) => {
  const at = map.get(key);
  if (at) at.push(value);
  else map.set(key, [value]);
};

/** The lookups of a schema, built on first use. */
export function lookupOf(/** @type {SchemaData} */ schema) {
  const kept = lookups.get(schema);
  if (kept) return kept;
  const { data, name: schemaName } = schema;
  /** @type {Lookup} */
  const made = {
    objects: [],
    relations: new Set(),
    columns: new Map(),
    parts: new Map(),
    foreignKeys: new Map(),
    routines: [],
    comments: new Map(),
  };
  const count = (/** @type {string | null | undefined} */ value) => {
    const n = value ? Number(value) : null;
    return n !== null && Number.isFinite(n) && n >= 0 ? n : null;
  };
  for (const [name, relkind, estimate, oid, note, rls, bytes] of data.relations ?? []) {
    made.objects.push({
      schema: schemaName,
      name: text(name),
      kind: RELKIND[text(relkind)] ?? "table",
      detail: [relkind === "p" ? "partitioned" : "", rls ? `RLS ${rls}` : ""]
        .filter(Boolean)
        .join(" · "),
      rows: count(estimate),
      ident: text(oid),
      ...(bytes ? { bytes: count(bytes) } : {}),
    });
    made.relations.add(text(name));
    if (note) made.comments.set(text(name), note);
  }
  for (const [table, name, type, flags, def, note] of data.columns ?? [])
    add(made.columns, text(table), {
      name: text(name),
      type: text(type),
      nullable: !text(flags).includes("n"),
      default: def || null,
      primary: text(flags).includes("p"),
      comment: text(note),
    });
  /** @type {Map<string, Part[]>} */
  const keys = new Map();
  for (const [table, contype, name, def, cols, refSchema, refTable, refCols] of data.constraints ??
    []) {
    const kind = CONTYPE[text(contype)] ?? "constraint";
    const foreign = kind === "foreign key";
    const extra = foreign
      ? refSchema === schemaName
        ? text(refTable)
        : `${text(refSchema)}.${text(refTable)}`
      : "";
    add(keys, text(table), {
      schema: schemaName,
      table: text(table),
      kind,
      name: text(name),
      detail: text(def),
      extra,
    });
    if (foreign)
      add(made.foreignKeys, text(table), {
        name: text(name),
        columns: list(cols),
        schema: text(refSchema),
        table: text(refTable),
        refColumns: list(refCols),
      });
  }
  for (const [table, rows] of keys)
    made.parts.set(
      table,
      rows.sort(
        (a, b) =>
          PART_ORDER.indexOf(a.kind) - PART_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name),
      ),
    );
  for (const [table, name, def, owned] of data.indexes ?? [])
    add(made.parts, text(table), {
      schema: schemaName,
      table: text(table),
      kind: "index",
      name: text(name),
      detail: text(def),
      extra: owned === "c" ? "constraint" : "",
    });
  for (const [table, name, def] of data.triggers ?? [])
    add(made.parts, text(table), {
      schema: schemaName,
      table: text(table),
      kind: "trigger",
      name: text(name),
      detail: text(def),
      extra: "",
    });
  for (const [name, args, prokind, result, oid, note] of data.routines ?? []) {
    const kind = prokind === "p" ? "procedure" : "function";
    made.routines.push({
      name: text(name),
      args: text(args),
      kind,
      result: text(result),
      ident: text(oid),
      comment: text(note),
    });
    made.objects.push({
      schema: schemaName,
      name: `${text(name)}(${text(args)})`,
      kind,
      detail: text(result),
      rows: null,
      ident: text(oid),
    });
  }
  const more = pgLookupOf(data, schemaName);
  made.objects.push(...more.objects);
  for (const [table, parts] of more.parts)
    made.parts.set(table, [...(made.parts.get(table) ?? []), ...parts]);
  lookups.set(schema, made);
  return made;
}

/**
 * The held schemas whose foreign keys name a table that is no more: in a schema just read that no
 * longer has that table or those columns, or in a schema that has gone. A rename there moves only
 * that schema's fingerprint, so these are read again in the same pass.
 * @param {Map<string, SchemaData>} schemas What is held once the schemas of `read` are in.
 * @param {Set<string>} read
 * @param {Set<string>} gone Schemas listed before and not now.
 */
export function staleReferences(schemas, read, gone) {
  /** @type {string[]} */
  const stale = [];
  for (const [name, schema] of schemas) {
    if (read.has(name)) continue;
    const keys = [...lookupOf(schema).foreignKeys.values()].flat();
    const broken = keys.some((key) => {
      if (gone.has(key.schema)) return true;
      const target = read.has(key.schema) ? schemas.get(key.schema) : undefined;
      if (!target) return false;
      const columns = lookupOf(target).columns.get(key.table);
      return !columns || key.refColumns.some((c) => !columns.some((col) => col.name === c));
    });
    if (broken) stale.push(name);
  }
  return stale;
}

/** The schema's rows a kind read, grouped by the schema's name (the first column). */
export function bySchema(/** @type {Row[]} */ rows) {
  /** @type {Map<string, Row[]>} */
  const out = new Map();
  for (const row of rows) add(out, text(row[0]), row.slice(1));
  return out;
}

/**
 * A rough size of a schema's rows as kept: the length of every value and a few bytes around each,
 * to leave a schema that cannot fit before writing it out.
 * @param {Record<string, Row[]>} data
 */
export function sizeOf(data) {
  let size = 0;
  for (const rows of Object.values(data))
    for (const row of rows) {
      size += 2;
      for (const value of row) size += (value?.length ?? 4) + 3;
    }
  return size;
}
