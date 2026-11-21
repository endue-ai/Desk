// The ER diagram's graph (PG-55): tables with their columns (type, nullability, keys, comment) and
// the foreign keys between them, from the schema cache's view (PostgreSQL, across schemas) or from
// the catalog's rows (the other engines, and a schema the cache does not hold); the relations the
// person drew, which the database does not declare; each end's cardinality; and which tables a
// diagram shows: its schemas (or the tables a filter keeps there), or a table and its neighbours to
// a depth, with the tables the person added and removed. Pure.

/**
 * @typedef {{ name: string, type: string, nullable: boolean, primary: boolean, foreign: boolean, comment: string }} Column
 * @typedef {{ id: string, schema: string, name: string, columns: Column[], comment: string }} Table
 * @typedef {"many" | "one" | "zero-one"} End
 *   At the referencing table, many (zero or many), or zero-one when its columns are a key of it; at
 *   the referenced table, one, or zero-one when a referencing column may be NULL.
 * @typedef {{
 *   name: string, from: string, to: string, fromColumns: string[], toColumns: string[],
 *   drawn: boolean, ends: { from: End, to: End },
 * }} Link
 *   `from` refers to `to` (table ids); `drawn` when the person drew it and the database has none.
 * @typedef {{ tables: Table[], links: Link[] }} Graph
 * @typedef {[string, string]} Ref A table as [schema, name], as the record keeps it.
 * @typedef {{ from: Ref, to: Ref, columns: string[], refColumns: string[] }} Drawn
 * @typedef {{ schemas: string[], around?: Ref, depth?: number, filter?: string }} Choice
 *   `around` with `depth`: that table and its neighbours; else the tables of `schemas`, those whose
 *   name holds `filter` when it is set.
 * @typedef {{ added: Ref[], removed: Ref[] }} Changes The tables the person added and removed.
 */

const SEP = "\u0000";
export const MAX_DEPTH = 9;

/** A table's id in the graph: its schema and name, apart. */
export const idOf = (/** @type {string} */ schema, /** @type {string} */ name) =>
  `${schema}${SEP}${name}`;
/** @returns {Ref} */
export const refOf = (/** @type {string} */ id) => {
  const at = id.indexOf(SEP);
  return [id.slice(0, at), id.slice(at + 1)];
};

/** The column sets of a table's unique constraints, from their definitions: `UNIQUE (a, "b c")`. */
export function uniqueSets(/** @type {{ kind: string, detail: string }[]} */ parts) {
  return parts.flatMap((part) => {
    if (part.kind !== "unique") return [];
    const inner = /\(([^)]*)\)\s*$/u.exec(part.detail)?.[1];
    if (!inner) return [];
    return [
      inner
        .split(",")
        .map((c) => c.trim())
        .map((c) => (c.startsWith('"') ? c.slice(1, -1).replaceAll('""', '"') : c)),
    ];
  });
}

/**
 * A link and its ends' cardinality.
 * @param {{ name: string, from: Table, to: string, fromColumns: string[], toColumns: string[], drawn?: boolean, uniques?: string[][] }} input
 * @returns {Link}
 */
export function linkOf({ name, from, to, fromColumns, toColumns, drawn = false, uniques = [] }) {
  const columns = new Map(from.columns.map((c) => [c.name, c]));
  const primary = from.columns.filter((c) => c.primary).map((c) => c.name);
  const same = (/** @type {string[]} */ set) =>
    set.length > 0 &&
    set.length === fromColumns.length &&
    set.every((c) => fromColumns.includes(c));
  const unique = [primary, ...uniques].some(same);
  const optional = fromColumns.some((c) => columns.get(c)?.nullable ?? false);
  return {
    name,
    from: from.id,
    to,
    fromColumns,
    toColumns,
    drawn,
    ends: { from: unique ? "zero-one" : "many", to: optional ? "zero-one" : "one" },
  };
}

/**
 * The graph of schemas the cache holds, from its view's public answers; a foreign key into a schema
 * not given is left out (`merge` keeps the ones whose both ends are in).
 * @param {Pick<import("../../schema-cache/view.js").CacheView, "objects" | "columns" | "foreignKeys" | "parts" | "comment">} view
 * @param {string[]} schemas
 * @returns {Graph}
 */
export function graphFromCache(view, schemas) {
  /** @type {Table[]} */
  const tables = [];
  /** @type {Array<() => Link>} */
  const pending = [];
  for (const schema of schemas)
    for (const object of view.objects(schema) ?? []) {
      if (object.kind !== "table") continue;
      const keys = view.foreignKeys(schema, object.name) ?? [];
      const foreign = new Set(keys.flatMap((k) => k.columns));
      /** @type {Table} */
      const table = {
        id: idOf(schema, object.name),
        schema,
        name: object.name,
        comment: view.comment(schema, object.name) ?? "",
        columns: (view.columns(schema, object.name) ?? []).map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          primary: c.primary,
          foreign: foreign.has(c.name),
          comment: c.comment ?? "",
        })),
      };
      tables.push(table);
      const uniques = uniqueSets(view.parts(schema, object.name) ?? []);
      for (const k of keys)
        pending.push(() =>
          linkOf({
            name: k.name,
            from: table,
            to: idOf(k.schema, k.table),
            fromColumns: k.columns,
            toColumns: k.refColumns,
            uniques,
          }),
        );
    }
  return keep({ tables, links: pending.map((make) => make()) });
}

/**
 * The graph of one schema from the catalog's diagram rows (schema/diagram.js's `diagramOf`).
 * @param {string} schema
 * @param {import("../../schema/diagram.js").Diagram} diagram
 * @returns {Graph}
 */
export function graphFromRows(schema, diagram) {
  const split = (/** @type {string} */ text) => (text ? text.split(", ") : []);
  const foreign = new Map(
    diagram.tables.map((t) => [
      t.name,
      new Set(diagram.links.filter((l) => l.from === t.name).flatMap((l) => split(l.fromColumns))),
    ]),
  );
  /** @type {Table[]} */
  const tables = diagram.tables.map((t) => ({
    id: idOf(schema, t.name),
    schema,
    name: t.name,
    comment: "",
    columns: t.columns.map((c) => ({
      name: c.name,
      type: c.type,
      nullable: c.nullable ?? false,
      primary: c.key,
      foreign: foreign.get(t.name)?.has(c.name) ?? false,
      comment: c.comment ?? "",
    })),
  }));
  const byName = new Map(tables.map((t) => [t.name, t]));
  const links = diagram.links.flatMap((l) => {
    const from = byName.get(l.from);
    if (!from) return [];
    const fromColumns = split(l.fromColumns);
    return [
      linkOf({
        name: l.name,
        from,
        to: idOf(schema, l.to),
        fromColumns,
        toColumns: split(l.toColumns),
      }),
    ];
  });
  return keep({ tables, links });
}

/** The links whose both ends are tables of the graph. */
const keep = (/** @type {Graph} */ graph) => {
  const ids = new Set(graph.tables.map((t) => t.id));
  return {
    tables: graph.tables,
    links: graph.links.filter((l) => ids.has(l.from) && ids.has(l.to)),
  };
};

/** Graphs of several schemas as one: each table once, and the links across them. */
export function merge(/** @type {Graph[]} */ graphs) {
  /** @type {Map<string, Table>} */
  const tables = new Map();
  for (const g of graphs) for (const t of g.tables) if (!tables.has(t.id)) tables.set(t.id, t);
  const seen = new Set();
  const links = graphs
    .flatMap((g) => g.links)
    .filter((l) => {
      const key = `${l.from}${SEP}${l.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return keep({ tables: [...tables.values()], links });
}

/**
 * The graph with the relations the person drew between its tables, each marked drawn.
 * @param {Graph} graph
 * @param {Drawn[]} drawn
 */
export function withDrawn(graph, drawn) {
  const byId = new Map(graph.tables.map((t) => [t.id, t]));
  const added = drawn.flatMap((d) => {
    const from = byId.get(idOf(...d.from));
    const to = idOf(...d.to);
    if (!from || !byId.has(to)) return [];
    return [
      linkOf({
        name: drawnName(d),
        from,
        to,
        fromColumns: d.columns,
        toColumns: d.refColumns,
        drawn: true,
      }),
    ];
  });
  return { tables: graph.tables, links: [...graph.links, ...added] };
}

/** A drawn relation's name: its ends and columns, as the person reads it. */
export const drawnName = (/** @type {Drawn} */ d) =>
  `${d.from[1]}${d.columns.length ? ` (${d.columns.join(", ")})` : ""} → ${d.to[1]}${d.refColumns.length ? ` (${d.refColumns.join(", ")})` : ""}`;

/** A table and the tables up to `depth` foreign keys away, either way. */
export function neighbours(/** @type {Graph} */ graph, /** @type {string} */ id, depth = 1) {
  /** @type {Map<string, string[]>} */
  const next = new Map();
  const add = (/** @type {string} */ a, /** @type {string} */ b) => {
    const list = next.get(a);
    if (list) list.push(b);
    else next.set(a, [b]);
  };
  for (const l of graph.links) {
    add(l.from, l.to);
    add(l.to, l.from);
  }
  const seen = new Set([id]);
  let ring = [id];
  for (let step = 0; step < Math.min(depth, MAX_DEPTH) && ring.length; step++) {
    /** @type {string[]} */
    const out = [];
    for (const at of ring)
      for (const n of next.get(at) ?? [])
        if (!seen.has(n)) {
          seen.add(n);
          out.push(n);
        }
    ring = out;
  }
  return seen;
}

/**
 * The ids of the tables a diagram shows: its choice, plus the tables added, less those removed;
 * only tables the graph has (a dropped table is gone).
 * @param {Graph} graph
 * @param {Choice} choice
 * @param {Changes} [changes]
 */
export function shownIds(graph, choice, changes = { added: [], removed: [] }) {
  const has = new Set(graph.tables.map((t) => t.id));
  /** @type {Set<string>} */
  let ids;
  if (choice.around) {
    const center = idOf(...choice.around);
    ids = has.has(center) ? neighbours(graph, center, choice.depth ?? 1) : new Set();
  } else {
    const needle = (choice.filter ?? "").toLowerCase();
    ids = new Set(
      graph.tables
        .filter((t) => choice.schemas.includes(t.schema))
        .filter((t) => !needle || t.name.toLowerCase().includes(needle))
        .map((t) => t.id),
    );
  }
  for (const ref of changes.added) if (has.has(idOf(...ref))) ids.add(idOf(...ref));
  for (const ref of changes.removed) ids.delete(idOf(...ref));
  return ids;
}

/** The tables of `ids` and the links between them, in the graph's order. */
export function subgraph(/** @type {Graph} */ graph, /** @type {Set<string>} */ ids) {
  return {
    tables: graph.tables.filter((t) => ids.has(t.id)),
    links: graph.links.filter((l) => ids.has(l.from) && ids.has(l.to)),
  };
}

/** What names a diagram after its connection: `public`, `public, sales`, `public.orders ±2`, a filter. */
export function nameOf(/** @type {Choice} */ choice) {
  if (choice.around) return `${choice.around.join(".")} ±${choice.depth ?? 1}`;
  const schemas = choice.schemas.join(", ");
  return choice.filter ? `${schemas} matching "${choice.filter}"` : schemas;
}
