// The target's structure of a copied table (PG-63), written by the plugin's own DDL of a table
// (schema/postgres.js `ddl`) from the source's catalog rows, renamed: the table under the target's
// schema and name, each key, check and index the target's (a name that starts with the source
// table's takes the target's in its place), a serial column's sequence made for the target. Foreign
// keys come apart, added once every table's rows are in; one that references a copied table points
// at its copy. Triggers are not copied, nor partitions: a partitioned or a foreign table becomes a
// plain one. A query's result makes a new table of the columns the server describes. No DOM.

import { closeStatement } from "../schema/common.js";
import { ddl } from "../schema/postgres.js";
import { qualified, quoteName, quoteText } from "../sql/quote.js";

/**
 * @typedef {(string | null)[][]} Rows
 * @typedef {{ name: string, definition: string, schema: string, table: string, shown: string }} ForeignKey
 *   `schema` and `table` are the referenced table's; `shown` is how the definition names it.
 * @typedef {{
 *   schema: string, name: string, columns: Rows, constraints: Rows, indexes: Rows,
 *   triggers: Rows, meta: Rows, keys: ForeignKey[],
 * }} TableDef
 *   The source's catalog rows (read.js), in the order `ddlQueries` asks them; `constraints` holds
 *   no foreign key, `keys` holds them.
 * @typedef {{ schema: string, name: string }} Name
 * @typedef {{
 *   create: string, keys: string, after: string, columns: string[], notes: string[],
 * }} Structure
 *   `create` is the sequences, the table and its indexes; `keys` the foreign keys; `after` sets
 *   each sequence past the copied values; `columns` the quoted names a COPY moves.
 */

const pq = (/** @type {string} */ s) => quoteName("postgresql", s);
const q = (/** @type {string} */ s) => quoteText("postgresql", s);
const at = (/** @type {Name} */ n) => qualified("postgresql", n.schema, n.name);
const SERIAL = /^nextval\('((?:[^']|'')+)'::regclass\)$/u;
const INDEX = /^(CREATE (?:UNIQUE )?INDEX )(.+?)( ON (?:ONLY )?)(.+?)( USING .*)$/su;

/** The key a table is known by in a copy of several. */
export const keyOf = (/** @type {string} */ schema, /** @type {string} */ name) =>
  JSON.stringify([schema, name]);

/** A name made of the source table's (`items_pkey`) as the target's (`stock_pkey`). */
export function renamed(
  /** @type {string} */ name,
  /** @type {string} */ from,
  /** @type {string} */ to,
) {
  if (from === to) return name;
  return name.startsWith(from) ? `${to}${name.slice(from.length)}` : `${to}_${name}`;
}

/** The last part of a regclass's text, unquoted: `"Shop"."Items_id_seq"` is `Items_id_seq`. */
function lastName(/** @type {string} */ text) {
  const match = /(?:"((?:[^"]|"")+)"|([^."]+))$/u.exec(text);
  return match?.[1]?.replaceAll('""', '"') ?? match?.[2] ?? text;
}

/**
 * The target's structure of one table.
 * @param {TableDef} def
 * @param {Name} target
 * @param {{ foreignKeys: boolean, copies: Map<string, Name> }} options `copies` maps each copied
 *   table's key to its target.
 * @returns {Structure}
 */
export function structureOf(def, target, options) {
  const from = def.name;
  const to = target.name;
  const name = at(target);
  /** @type {string[]} */
  const notes = [];
  const sequences = [];
  const owned = [];
  const after = [];
  const columns = def.columns.map((row) => {
    const [column = "", , , value, identity, generated] = row;
    const serial = value ? SERIAL.exec(value) : null;
    if (identity === "a" || identity === "d")
      after.push(
        setval(`pg_catalog.pg_get_serial_sequence(${q(name)}, ${q(column)})`, column, name),
      );
    if (!serial || generated) return row;
    const sequence = at({
      schema: target.schema,
      name: renamed(lastName(serial[1] ?? ""), from, to),
    });
    sequences.push(`CREATE SEQUENCE ${sequence};\n`);
    owned.push(`ALTER SEQUENCE ${sequence} OWNED BY ${name}.${pq(column)};\n`);
    after.push(setval(q(sequence), column, name));
    return [
      row[0] ?? "",
      row[1] ?? "",
      row[2] ?? "",
      `nextval(${q(sequence)}::regclass)`,
      ...row.slice(4),
    ];
  });
  const constraints = def.constraints.map((row) => [
    row[0],
    renamed(row[1] ?? "", from, to),
    ...row.slice(2),
  ]);
  const indexes = def.indexes.map((row) => {
    if (row[3] === "constraint") return row;
    const own = renamed(row[1] ?? "", from, to);
    const text = (row[2] ?? "").replace(
      INDEX,
      (_, head, _n, on, _t, tail) => `${head}${pq(own)}${on}${name}${tail}`,
    );
    return [row[0], own, text, row[3]];
  });
  const [relkind, persistence, ...rest] = def.meta[0] ?? [];
  if (relkind === "p")
    notes.push(
      `${at(def)} is partitioned: its copy is a plain table that holds every partition's rows.`,
    );
  if (relkind === "f")
    notes.push(`${at(def)} is a foreign table: its copy is a plain table that holds its rows.`);
  if (def.triggers.length)
    notes.push(
      `${at(def)}'s ${def.triggers.length === 1 ? "trigger is" : `${def.triggers.length} triggers are`} not copied.`,
    );
  const meta = [
    [
      "r",
      persistence === "t" ? "p" : (persistence ?? "p"),
      rest[0] ?? null,
      null,
      null,
      ...rest.slice(3),
    ],
  ];
  const object = {
    schema: target.schema,
    name: to,
    kind: "table",
    detail: "",
    rows: null,
    ident: "",
  };
  const table = ddl(/** @type {any} */ (object), [columns, constraints, indexes, [], meta]);
  const keys = options.foreignKeys
    ? def.keys.map((k) => foreignKey(k, def, target, options.copies))
    : [];
  return {
    create: [...sequences, table, ...owned].join("\n"),
    keys: keys.join(""),
    after: after.join(""),
    columns: columns.filter((row) => !row[5]).map((row) => pq(row[0] ?? "")),
    notes,
  };
}

/** A statement that sets a sequence past the largest value copied into its column. */
function setval(
  /** @type {string} */ sequence,
  /** @type {string} */ column,
  /** @type {string} */ table,
) {
  return `SELECT pg_catalog.setval(${sequence}, coalesce(max(${pq(column)}), 0) + 1, false) FROM ${table};\n`;
}

/** A foreign key added to the target, its reference the copy's when that table is copied too. */
function foreignKey(
  /** @type {ForeignKey} */ key,
  /** @type {TableDef} */ def,
  /** @type {Name} */ target,
  /** @type {Map<string, Name>} */ copies,
) {
  const copy = copies.get(keyOf(key.schema, key.table));
  const referenced = copy ? at(copy) : qualified("postgresql", key.schema, key.table);
  const definition = key.definition.replace(
    `REFERENCES ${key.shown}(`,
    `REFERENCES ${referenced}(`,
  );
  const name = pq(renamed(key.name, def.name, target.name));
  return closeStatement(`ALTER TABLE ${at(target)} ADD CONSTRAINT ${name} ${definition}`);
}

/**
 * A new table of a query's columns, typed as the server describes them.
 * @param {{ name: string, type: string }[]} columns
 * @param {Name} target
 */
export function queryTable(columns, target) {
  const lines = columns.map((c) => `    ${pq(c.name)} ${c.type}`);
  return `CREATE TABLE ${at(target)} (\n${lines.join(",\n")}\n);\n`;
}
