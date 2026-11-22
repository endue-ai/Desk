// The table form's edits (PG-51): each takes a design and gives a new one, so the form, a command's
// arguments and the tests change it the same way. An identity or a generation clears the column's
// default and makes it NOT NULL as PostgreSQL does; a column in the primary key is NOT NULL; a new
// part removed goes, an existing column dropped stays listed (`dropped`) until it is kept again; a
// new table's columns move, an existing table's keep the server's order. Pure.

import { byId, newColumn, nextId } from "./model.js";

/**
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./model.js").Column} Column
 * @typedef {import("./model.js").ListName} ListName
 * @typedef {import("./types.js").PgType} PgType
 */

/** Whether a part came from the server (its id is its catalog's). */
export const existing = (/** @type {string} */ id) => !id.startsWith("n");

/** The table's own fields. */
export const setTable = (
  /** @type {Design} */ design,
  /** @type {Partial<Pick<Design, "name" | "comment" | "owner" | "schema">>} */ patch,
) => ({ ...design, ...patch });

/** A new column at the end; answers the design and the column's id. */
export function addColumn(
  /** @type {Design} */ design,
  /** @type {Partial<Column>} */ fields = {},
) {
  const made = nextId(design);
  const column = newColumn(made.id, fields);
  return { design: { ...made.design, columns: [...made.design.columns, column] }, id: made.id };
}

/** A column's fields, with what goes with them. */
export function setColumn(
  /** @type {Design} */ design,
  /** @type {string} */ id,
  /** @type {Partial<Column>} */ patch,
) {
  const columns = design.columns.map((c) => {
    if (c.id !== id) return c;
    const next = { ...c, ...patch };
    if (patch.identity) Object.assign(next, { default: "", generated: "", nullable: false });
    if (patch.generated?.trim()) Object.assign(next, { default: "", identity: "" });
    if (patch.default?.trim()) Object.assign(next, { identity: "", generated: "" });
    if (design.primaryKey?.columns.includes(id)) next.nullable = false;
    return next;
  });
  return { ...design, columns };
}

/** Put a column in the primary key or take it out (an empty key goes). */
export function toggleKey(/** @type {Design} */ design, /** @type {string} */ id, on = true) {
  const now = design.primaryKey;
  if (!on) {
    if (!now) return design;
    const columns = now.columns.filter((c) => c !== id);
    return { ...design, primaryKey: columns.length ? { ...now, columns } : null };
  }
  const made = now ? { design, id: now.id } : nextId(design);
  const key = now ?? { id: made.id, name: "", columns: [] };
  const columns = key.columns.includes(id) ? key.columns : [...key.columns, id];
  return setColumn({ ...made.design, primaryKey: { ...key, columns } }, id, {});
}

/** Take a column out of every key, index and partition key that names it. */
function unreferenced(/** @type {Design} */ design, /** @type {string} */ id) {
  const out = (/** @type {string[]} */ ids) => ids.filter((c) => c !== id);
  const pk = design.primaryKey
    ? { ...design.primaryKey, columns: out(design.primaryKey.columns) }
    : null;
  return {
    ...design,
    primaryKey: pk?.columns.length ? pk : null,
    uniques: design.uniques.map((u) => ({ ...u, columns: out(u.columns) })),
    foreignKeys: design.foreignKeys.map((f) => ({
      ...f,
      columns: out(f.columns),
      refColumns: f.self ? out(f.refColumns) : f.refColumns,
    })),
    indexes: design.indexes.map((i) => ({ ...i, keys: i.keys.filter((k) => k.column !== id) })),
    partition: { ...design.partition, keys: design.partition.keys.filter((k) => k.column !== id) },
  };
}

/** Drop a column: a new one goes, with its place in keys; an existing one stays listed, dropped. */
export function dropColumn(/** @type {Design} */ design, /** @type {string} */ id) {
  if (!existing(id)) {
    const gone = unreferenced(design, id);
    return { ...gone, columns: gone.columns.filter((c) => c.id !== id) };
  }
  return {
    ...design,
    columns: design.columns.map((c) => (c.id === id ? { ...c, dropped: true } : c)),
  };
}

/** Keep a column that was to be dropped. */
export const keepColumn = (/** @type {Design} */ design, /** @type {string} */ id) => ({
  ...design,
  columns: design.columns.map((c) => {
    if (c.id !== id) return c;
    const { dropped: _, ...kept } = c;
    return kept;
  }),
});

/** Move a new table's column up (-1) or down (+1). */
export function moveColumn(
  /** @type {Design} */ design,
  /** @type {string} */ id,
  /** @type {number} */ by,
) {
  const at = design.columns.findIndex((c) => c.id === id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= design.columns.length) return design;
  const columns = [...design.columns];
  const [moved] = columns.splice(at, 1);
  columns.splice(to, 0, /** @type {Column} */ (moved));
  return { ...design, columns };
}

/** The defaults of each list's new part. */
const FRESH = {
  uniques: { name: "", columns: [] },
  checks: { name: "", expression: "" },
  foreignKeys: {
    name: "",
    columns: [],
    self: false,
    refSchema: "",
    refTable: "",
    refColumns: [],
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  },
  indexes: { name: "", method: "btree", unique: false, keys: [], where: "", concurrently: false },
  others: { name: "", kept: "" },
};

/**
 * A new part of a list; answers the design and its id.
 * @returns {{ design: Design, id: string }}
 */
export function addPart(
  /** @type {Design} */ design,
  /** @type {ListName} */ list,
  /** @type {Record<string, unknown>} */ fields = {},
) {
  const made = nextId(design);
  const part = { ...FRESH[list], ...fields, id: made.id };
  return { design: { ...made.design, [list]: [...made.design[list], part] }, id: made.id };
}

/**
 * A part's fields.
 * @returns {Design}
 */
export function setPart(
  /** @type {Design} */ design,
  /** @type {ListName | "primaryKey"} */ list,
  /** @type {string} */ id,
  /** @type {Record<string, unknown>} */ patch,
) {
  if (list === "primaryKey") {
    const pk = design.primaryKey;
    if (!pk || pk.id !== id) return design;
    const next = /** @type {typeof pk} */ ({ ...pk, ...patch });
    const done = { ...design, primaryKey: next };
    return next.columns.reduce((d, c) => setColumn(d, c, {}), /** @type {Design} */ (done));
  }
  const items = /** @type {{ id: string }[]} */ (design[list]);
  if (!byId(items, id)) return design;
  return { ...design, [list]: items.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

/** Remove a part (an existing one is dropped by the script). */
export function removePart(
  /** @type {Design} */ design,
  /** @type {ListName | "primaryKey"} */ list,
  /** @type {string} */ id,
) {
  if (list === "primaryKey")
    return design.primaryKey?.id === id ? { ...design, primaryKey: null } : design;
  const items = /** @type {{ id: string }[]} */ (design[list]);
  return { ...design, [list]: items.filter((p) => p.id !== id) };
}

/** A new table's partitioning. */
export const setPartition = (
  /** @type {Design} */ design,
  /** @type {Partial<Design["partition"]>} */ patch,
) => ({ ...design, partition: { ...design.partition, ...patch } });

/** Names PostgreSQL's DDL takes for its types, to their labels. */
const ALIASES = /** @type {Record<string, string>} */ ({
  int: "integer",
  decimal: "numeric",
  float: "double precision",
  varchar: "character varying",
  char: "character",
  timestamp: "timestamp without time zone",
  time: "time without time zone",
});

/**
 * A type as a command names it (`varchar(120)`, `int4[]`, `app.mood`) as a label of the server's
 * types, its length and whether it is an array; the label as given when no type matches.
 * @param {PgType[]} types
 * @param {string} given
 */
export function typeFrom(types, given) {
  const match = /^\s*(.*?)\s*(?:\(\s*([\d\s,-]+)\s*\))?\s*(\[\])?\s*$/u.exec(given);
  const name = (match?.[1] ?? given).trim();
  const length = (match?.[2] ?? "").replace(/\s+/gu, "");
  const array = Boolean(match?.[3]);
  const lower = name.toLowerCase();
  const found =
    types.find((t) => t.label === name) ??
    types.find((t) => t.builtin && (t.label === lower || t.name === lower)) ??
    types.find((t) => t.builtin && t.label === ALIASES[lower]);
  return { type: found?.label ?? name, length, array };
}
