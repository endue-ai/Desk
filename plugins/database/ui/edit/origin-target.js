// A PostgreSQL result's edit target from its columns' origins (PG-45, ADR 0350): the row description
// names each column's table (OID) and column number, so a result that joins tables is mapped column
// by column to the relations the catalog read by OID (edit/origins.js), never by the statement's
// text. A table's cells can change when its rows can be told apart in the result: its primary key,
// else a unique index on NOT NULL columns, else its ctid when the result selects it, else every
// one of its columns; and when the server can change it (a view by pg_relation_is_updatable, each
// of its columns by pg_column_is_updatable). Every other cell says why it cannot. A table the
// statement reads more than once is never mapped: which of its rows a column shows is not certain.
// Pure.

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("./pending.js").Target} Target
 * @typedef {import("./pending.js").TargetTable} TargetTable
 * @typedef {import("./pending.js").TargetColumn} TargetColumn
 * @typedef {{ attnum: number, name: string, type: string, notNull: boolean, default: string | null, updatable: boolean }} RelationColumn
 * @typedef {{ primary: boolean, name: string, columns: number[] }} Key
 *   A unique index that can key rows: not partial, no expressions, every key column NOT NULL.
 * @typedef {{
 *   oid: number, schema: string, name: string, relkind: string, updatable: number,
 *   columns: RelationColumn[], keys: Key[], references: number[],
 * }} Relation
 *   `updatable` is pg_relation_is_updatable's mask (4 update, 8 insert, 16 delete); `keys` the
 *   primary key first; `references` the OIDs its foreign keys point at.
 */

const UPDATE = 4;
const INSERT = 8;
const DELETE = 16;
const KINDS = /** @type {Record<string, string>} */ ({
  r: "table",
  p: "table",
  v: "view",
  f: "foreign table",
});

/**
 * Why none of a relation's cells can change, or its key.
 * @param {Relation} rel
 * @param {Map<number, number>} at The first result column of each of its column numbers.
 * @param {number} ctid The result column of its ctid, -1 without.
 * @param {boolean} twice Whether the statement reads it more than once.
 * @returns {{ why: string } | { by: TargetTable["by"], key: number[], match: number[] }}
 */
function keyOf(rel, at, ctid, twice) {
  const { name } = rel;
  if (rel.relkind === "m")
    return { why: `${name} is a materialized view: its rows are computed, not stored.` };
  if (!KINDS[rel.relkind]) return { why: `${name} is not a table or a view: it cannot change.` };
  if (twice)
    return {
      why: `${name} is read more than once in this query, so which of its rows a cell shows is not certain.`,
    };
  if (!(rel.updatable & UPDATE))
    return {
      why:
        rel.relkind === "v"
          ? `View ${name} cannot be updated: the server changes a view only when it reads one table without grouping, or through its INSTEAD OF triggers.`
          : `${name} takes no changes on this server.`,
    };
  const cols = (/** @type {number[]} */ nums) => nums.map((n) => at.get(n) ?? -1);
  const lacking = (/** @type {Key} */ key) =>
    key.columns
      .filter((n) => !at.has(n))
      .map((n) => rel.columns.find((c) => c.attnum === n)?.name ?? String(n));
  const primary = rel.keys.find((k) => k.primary);
  if (primary) {
    const missing = lacking(primary);
    if (missing.length === 0) return { by: "primary", key: cols(primary.columns), match: [] };
    return {
      why: `The result lacks ${missing.join(", ")} of ${name}'s primary key: add it to change ${name}'s cells.`,
    };
  }
  const unique = rel.keys.find((k) => lacking(k).length === 0);
  if (unique) return { by: "unique", key: cols(unique.columns), match: [] };
  const mine = [...at.values()].sort((a, b) => a - b);
  if (ctid >= 0 && rel.relkind === "r") return { by: "ctid", key: [ctid], match: mine };
  if (rel.columns.every((c) => at.has(c.attnum))) return { by: "row", key: [], match: mine };
  const [first] = rel.keys;
  if (first)
    return {
      why: `The result lacks ${lacking(first).join(", ")} of ${name}'s unique key ${first.name}: add it to change ${name}'s cells.`,
    };
  return {
    why:
      rel.relkind === "r"
        ? `${name} has no primary key or unique key on NOT NULL columns: select its ctid (SELECT ctid, * FROM ${name}) or every one of its columns to change its rows.`
        : `${name} has no key: select every one of its columns to change its rows.`,
  };
}

/** Each table's place by foreign key: a table referenced by another of the result comes first. */
function ranks(/** @type {Relation[]} */ rels) {
  const oids = new Set(rels.map((r) => r.oid));
  /** @type {Map<number, number>} */
  const done = new Map();
  const rankOf = (/** @type {Relation} */ rel, /** @type {Set<number>} */ path) => {
    const known = done.get(rel.oid);
    if (known !== undefined) return known;
    path.add(rel.oid);
    let rank = 0;
    for (const oid of rel.references) {
      const parent = rels.find((r) => r.oid === oid);
      if (!parent || oid === rel.oid || !oids.has(oid) || path.has(oid)) continue;
      rank = Math.max(rank, rankOf(parent, path) + 1);
    }
    path.delete(rel.oid);
    done.set(rel.oid, rank);
    return rank;
  };
  return rels.map((rel) => rankOf(rel, new Set()));
}

/**
 * The target of a result whose columns carry origins.
 * @param {ResultSet} set
 * @param {Map<number, Relation>} relations The relations read, by OID.
 * @param {(name: string) => boolean} repeated Whether the statement reads a name more than once.
 * @returns {Target}
 */
export function originTarget(set, relations, repeated) {
  const origins = set.origins ?? [];
  /** @type {Relation[]} */
  const read = [];
  for (const o of origins) {
    const rel = relations.get(o.table);
    if (rel && !read.includes(rel)) read.push(rel);
  }
  const shape = read.map((rel) => {
    /** @type {Map<number, number>} */
    const at = new Map();
    let ctid = -1;
    origins.forEach((o, i) => {
      if (o.table !== rel.oid) return;
      if (o.column === -1 && ctid < 0) ctid = i;
      if (o.column > 0 && !at.has(o.column)) at.set(o.column, i);
    });
    return { rel, at, found: keyOf(rel, at, ctid, repeated(rel.name)) };
  });
  const editable = shape.filter((s) => !("why" in s.found));
  const rank = ranks(editable.map((s) => s.rel));
  /** @type {TargetTable[]} */
  const tables = editable.map(({ rel, found }, t) => {
    const key = "why" in found ? { by: /** @type {const} */ ("row"), key: [], match: [] } : found;
    const alone = read.length === 1;
    return {
      schema: rel.schema,
      name: rel.name,
      kind: KINDS[rel.relkind] ?? "table",
      ...key,
      insert: alone && Boolean(rel.updatable & INSERT),
      delete: alone && Boolean(rel.updatable & DELETE),
      rank: rank[t] ?? 0,
    };
  });
  /** @type {TargetColumn[]} */
  const columns = set.columns.map((label, i) => {
    const off = (/** @type {string} */ why) => ({
      name: label,
      type: "",
      key: false,
      known: false,
      why,
    });
    const o = origins[i];
    if (!o || o.table === 0)
      return off(`${label} is computed by the query, not read from a table: it cannot change.`);
    const s = shape.find((x) => x.rel.oid === o.table);
    if (!s) return off(`${label}'s table was not found in the catalog: it cannot change.`);
    const { rel, at, found } = s;
    if (o.column < 0)
      return off(
        o.column === -1
          ? `${label} is ${rel.name}'s row id (ctid): the server sets it.`
          : `${label} is a system column of ${rel.name}: the server sets it.`,
      );
    const column = rel.columns.find((c) => c.attnum === o.column);
    if (!column) return off(`${label} was not found in ${rel.name}: it cannot change.`);
    if (at.get(o.column) !== i)
      return off(`${column.name} of ${rel.name} is in the result twice: change its first column.`);
    if ("why" in found) return off(found.why);
    if (!column.updatable)
      return off(`${column.name} is computed by view ${rel.name}: it cannot change.`);
    const t = editable.indexOf(s);
    return {
      name: column.name,
      type: column.type,
      key: found.key.includes(i),
      known: true,
      table: t,
    };
  });
  const [first] = tables;
  const fallback = read[0];
  return {
    dialect: "postgresql",
    schema: first?.schema ?? fallback?.schema ?? "",
    name: first?.name ?? fallback?.name ?? "",
    columns,
    key: [...new Set(tables.flatMap((t) => (t.by === "row" ? [] : t.key)))],
    tables,
    ...(read.length > 1 ? { joined: read.map((r) => r.name) } : {}),
  };
}
