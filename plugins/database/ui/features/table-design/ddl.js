// The pieces of DDL the table form writes (PG-51): a column's definition, a list of columns or of
// keys, a constraint's clause, an index's statement, a comment, each with every identifier quoted by
// the plugin's helpers (a table, a column, a constraint, an index, a role, an index method) and
// every expression written as typed, in parentheses where it stands alone. Pure.

import { qualified, quoteName, quoteText } from "../../sql/quote.js";
import { nameOf } from "./model.js";
import { typeSql } from "./types.js";

/**
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./model.js").Column} Column
 * @typedef {import("./model.js").Key} Key
 * @typedef {import("./model.js").Unique} Unique
 * @typedef {import("./model.js").Check} Check
 * @typedef {import("./model.js").ForeignKey} ForeignKey
 * @typedef {import("./model.js").Index} Index
 * @typedef {import("./types.js").PgType} PgType
 */

const PG = "postgresql";
export const q = (/** @type {string} */ name) => quoteName(PG, name);
export const text = (/** @type {string} */ value) => (value === "" ? "NULL" : quoteText(PG, value));

/** The table a design names, quoted. */
export const tableSql = (/** @type {Design} */ design) => qualified(PG, design.schema, design.name);

/** A list of columns by id: ("a", "b"). */
export const columnList = (/** @type {Design} */ design, /** @type {string[]} */ ids) =>
  `(${ids.map((id) => q(nameOf(design, id))).join(", ")})`;

/** A list of keys: a column quoted, an expression in parentheses. */
export const keyList = (/** @type {Design} */ design, /** @type {Key[]} */ keys) =>
  `(${keys.map((k) => (k.column ? q(nameOf(design, k.column)) : `(${k.expression.trim()})`)).join(", ")})`;

/** What a column holds besides its type: its generation, its identity or its default. */
function holdsOf(/** @type {Column} */ column) {
  if (column.generated.trim()) return ` GENERATED ALWAYS AS (${column.generated.trim()}) STORED`;
  if (column.identity) return ` GENERATED ${column.identity.toUpperCase()} AS IDENTITY`;
  if (column.default.trim()) return ` DEFAULT ${column.default.trim()}`;
  return "";
}

/** A column's definition: `"name" type DEFAULT now() NOT NULL`. */
export function columnSql(/** @type {PgType[]} */ types, /** @type {Column} */ column) {
  const notNull = column.nullable && !column.identity ? "" : " NOT NULL";
  return `${q(column.name)} ${typeSql(types, column)}${holdsOf(column)}${notNull}`;
}

/** `CONSTRAINT "name" ` when the part has a name; the server names it otherwise. */
const named = (/** @type {{ name: string }} */ part) =>
  part.name.trim() === "" ? "" : `CONSTRAINT ${q(part.name)} `;

/** The table a foreign key references, quoted. */
export const referenced = (/** @type {Design} */ design, /** @type {ForeignKey} */ fk) =>
  fk.self ? tableSql(design) : qualified(PG, fk.refSchema, fk.refTable);

/** A foreign key's referenced columns: this table's by id, another's by name. */
const refList = (/** @type {Design} */ design, /** @type {ForeignKey} */ fk) =>
  fk.self ? columnList(design, fk.refColumns) : `(${fk.refColumns.map(q).join(", ")})`;

/**
 * A constraint's clause, as a table's definition or ADD takes it.
 * @param {Design} design
 * @param {"primary" | "unique" | "check" | "foreign"} kind
 * @param {Unique | Check | ForeignKey} part
 */
export function constraintSql(design, kind, part) {
  if (kind === "primary")
    return `${named(part)}PRIMARY KEY ${columnList(design, /** @type {Unique} */ (part).columns)}`;
  if (kind === "unique")
    return `${named(part)}UNIQUE ${columnList(design, /** @type {Unique} */ (part).columns)}`;
  if (kind === "check")
    return `${named(part)}CHECK (${/** @type {Check} */ (part).expression.trim()})`;
  const fk = /** @type {ForeignKey} */ (part);
  const del = fk.onDelete === "NO ACTION" ? "" : ` ON DELETE ${fk.onDelete}`;
  const upd = fk.onUpdate === "NO ACTION" ? "" : ` ON UPDATE ${fk.onUpdate}`;
  return `${named(fk)}FOREIGN KEY ${columnList(design, fk.columns)} REFERENCES ${referenced(design, fk)} ${refList(design, fk)}${del}${upd}`;
}

/** An index's CREATE INDEX, CONCURRENTLY when chosen. */
export function indexSql(
  /** @type {Design} */ design,
  /** @type {Index} */ index,
  concurrently = false,
) {
  const unique = index.unique ? "UNIQUE " : "";
  const how = concurrently ? "CONCURRENTLY " : "";
  const name = index.name.trim() === "" ? "" : `${q(index.name)} `;
  const where = index.where.trim() ? ` WHERE ${index.where.trim()}` : "";
  return `CREATE ${unique}INDEX ${how}${name}ON ${tableSql(design)} USING ${q(index.method)} ${keyList(design, index.keys)}${where}`;
}

/** An index of the design's schema, quoted. */
export const indexName = (/** @type {Design} */ design, /** @type {string} */ name) =>
  qualified(PG, design.schema, name);

/** COMMENT ON TABLE. */
export const tableComment = (/** @type {Design} */ design) =>
  `COMMENT ON TABLE ${tableSql(design)} IS ${text(design.comment)}`;

/** COMMENT ON COLUMN. */
export const columnComment = (/** @type {Design} */ design, /** @type {Column} */ column) =>
  `COMMENT ON COLUMN ${tableSql(design)}.${q(column.name)} IS ${text(column.comment)}`;

/** ALTER TABLE ... OWNER TO. */
export const ownerSql = (/** @type {Design} */ design) =>
  `ALTER TABLE ${tableSql(design)} OWNER TO ${q(design.owner.trim())}`;
