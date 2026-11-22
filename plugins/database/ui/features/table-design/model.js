// A table's design as the table form holds it (PG-51, ADR 0324): its columns, keys, checks,
// foreign keys, indexes, partitioning, comment and owner, each part with an id that stays when it is
// renamed (so a rename is a rename, never a drop and an add). A part read from the server keeps its
// id across edits; a new one takes the next of the design's own counter. `kept` holds the definition
// of a part the form cannot write (DEFERRABLE, INCLUDE ...): it can be renamed or dropped, not
// changed. Pure.

/**
 * @typedef {"" | "always" | "by default"} Identity
 * @typedef {{
 *   id: string, name: string, type: string, length: string, array: boolean, nullable: boolean,
 *   default: string, identity: Identity, generated: string, comment: string, dropped?: boolean,
 * }} Column
 *   `type` is a label of the server's types (types.js), `length` its modifier as typed ("120",
 *   "10,2"), `default` and `generated` expressions as typed; `dropped` an existing column the form
 *   drops (it stays listed, struck through, until the person keeps it).
 * @typedef {{ column: string, expression: string }} Key
 *   An index's or a partition's key: a column's id, else an expression.
 * @typedef {{ id: string, name: string, columns: string[], kept?: string }} Unique
 *   A primary key or a unique constraint, on columns by id.
 * @typedef {{ id: string, name: string, expression: string, kept?: string }} Check
 * @typedef {"NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT"} Action
 * @typedef {{
 *   id: string, name: string, columns: string[], self: boolean, refSchema: string,
 *   refTable: string, refColumns: string[], onDelete: Action, onUpdate: Action, kept?: string,
 * }} ForeignKey
 *   `self`: it references this table, and `refColumns` are this table's columns by id; otherwise
 *   they are the referenced table's column names.
 * @typedef {{
 *   id: string, name: string, method: string, unique: boolean, keys: Key[], where: string,
 *   concurrently: boolean, kept?: string,
 * }} Index
 * @typedef {{ id: string, name: string, kept: string }} Other An exclusion constraint, kept.
 * @typedef {"" | "range" | "list" | "hash"} PartitionBy
 * @typedef {{ by: PartitionBy, keys: Key[] }} Partition
 * @typedef {{
 *   schema: string, name: string, comment: string, owner: string, columns: Column[],
 *   primaryKey: Unique | null, uniques: Unique[], checks: Check[], foreignKeys: ForeignKey[],
 *   indexes: Index[], others: Other[], partition: Partition, seq: number,
 * }} Design
 * @typedef {"uniques" | "checks" | "foreignKeys" | "indexes" | "others"} ListName
 */

export const ACTIONS = /** @type {const} */ ([
  "NO ACTION",
  "RESTRICT",
  "CASCADE",
  "SET NULL",
  "SET DEFAULT",
]);
export const PARTITIONS = /** @type {const} */ (["", "range", "list", "hash"]);

/** A new table's design in a schema, with nothing in it yet. */
export function blank(/** @type {string} */ schema) {
  /** @type {Design} */
  const design = {
    schema,
    name: "",
    comment: "",
    owner: "",
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
  return design;
}

/** A design with its counter moved on, and the id it gave. */
export function nextId(/** @type {Design} */ design) {
  const seq = design.seq + 1;
  return { design: { ...design, seq }, id: `n${seq}` };
}

/** A new column's fields. */
export const newColumn = (/** @type {string} */ id, /** @type {Partial<Column>} */ fields = {}) =>
  /** @type {Column} */ ({
    id,
    name: "",
    type: "",
    length: "",
    array: false,
    nullable: true,
    default: "",
    identity: "",
    generated: "",
    comment: "",
    ...fields,
  });

/** The columns that stay (not dropped). */
export const living = (/** @type {Design} */ design) => design.columns.filter((c) => !c.dropped);

/** A column by id, or undefined. */
export const columnOf = (/** @type {Design} */ design, /** @type {string} */ id) =>
  design.columns.find((c) => c.id === id);

/** A column's name by id ("" when it is gone). */
export const nameOf = (/** @type {Design} */ design, /** @type {string} */ id) =>
  columnOf(design, id)?.name ?? "";

/** Whether a column is in the primary key. */
export const inPrimaryKey = (/** @type {Design} */ design, /** @type {string} */ id) =>
  design.primaryKey?.columns.includes(id) === true;

/** The same key: a column by id or an expression by its text. */
export const sameKey = (/** @type {Key} */ a, /** @type {Key} */ b) =>
  a.column === b.column && (a.column !== "" || a.expression.trim() === b.expression.trim());

/** Two lists of keys hold the same keys in the same order. */
export const sameKeys = (/** @type {Key[]} */ a, /** @type {Key[]} */ b) =>
  a.length === b.length && a.every((k, i) => sameKey(k, /** @type {Key} */ (b[i])));

/** Two lists of strings are the same in the same order. */
export const sameList = (/** @type {string[]} */ a, /** @type {string[]} */ b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** The first item of a list with this id, or undefined. */
export function byId(/** @type {{ id: string }[]} */ list, /** @type {string} */ id) {
  return list.find((item) => item.id === id);
}
