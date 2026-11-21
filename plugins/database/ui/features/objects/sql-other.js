// MySQL's and SQLite's statements for the explorer's operations (PG-52): the subset their DDL
// has (kinds.js says which). MySQL renames and moves a table or a view with RENAME TABLE and names
// a table's part on its table; SQLite renames only a table, empties one with DELETE FROM (it has no
// TRUNCATE) and replaces a view by dropping and creating it in one transaction. Pure.

import { qualified, quoteName, quoteText } from "../../sql/quote.js";
import { newName } from "./checks.js";
import { kindSql } from "./kinds.js";
import { sourceText } from "./sql-postgres.js";

/**
 * @typedef {import("./kinds.js").Target} Target
 * @typedef {import("./sql-postgres.js").AnyOp} AnyOp
 * @typedef {import("./sql-postgres.js").Facts} Facts
 * @typedef {import("./sql-postgres.js").Answers} Answers
 */

const MY = "mysql";
const my = (/** @type {string} */ name) => quoteName(MY, name);

/**
 * MySQL's statement of an operation.
 * @param {AnyOp} op
 * @param {Target} target
 * @param {Facts} facts
 * @param {Answers} answers
 */
export function mysqlScript(op, target, facts, answers) {
  const spec = kindSql(MY, target.kind);
  if (!spec) throw new Error(`A ${target.kind} is not changed from here on MySQL.`);
  const ref = qualified(MY, target.schema, target.name);
  const table = qualified(MY, target.schema, target.table ?? "");
  const { values } = answers;
  switch (op) {
    case "rename": {
      const to = newName(MY, values.to, target.name);
      if (target.kind === "index")
        return `ALTER TABLE ${table} RENAME INDEX ${my(target.name)} TO ${my(to)};`;
      if (target.kind === "event")
        return `ALTER EVENT ${ref} RENAME TO ${qualified(MY, target.schema, to)};`;
      return `RENAME TABLE ${ref} TO ${qualified(MY, target.schema, to)};`;
    }
    case "move":
      return `RENAME TABLE ${ref} TO ${qualified(MY, newName(MY, values.to, target.schema, "database"), target.name)};`;
    case "comment": {
      const text = quoteText(MY, values.comment ?? "");
      if (target.kind === "table") return `ALTER TABLE ${ref} COMMENT = ${text};`;
      return `ALTER ${spec.word} ${ref} COMMENT ${text};`;
    }
    case "drop":
      return mysqlDrop(target, ref, table);
    case "truncate":
      return `TRUNCATE TABLE ${ref};`;
    case "apply":
      return sourceText(facts);
    default:
      throw new Error(`${op} is not on MySQL.`);
  }
}

/** A drop: a table's part through ALTER TABLE, by what it is. */
function mysqlDrop(
  /** @type {Target} */ target,
  /** @type {string} */ ref,
  /** @type {string} */ table,
) {
  const name = my(target.name);
  if (target.kind === "primary key" || (target.kind === "index" && target.name === "PRIMARY"))
    return `ALTER TABLE ${table} DROP PRIMARY KEY;`;
  if (target.kind === "index") return `DROP INDEX ${name} ON ${table};`;
  if (target.kind === "unique") return `ALTER TABLE ${table} DROP INDEX ${name};`;
  if (target.kind === "check") return `ALTER TABLE ${table} DROP CHECK ${name};`;
  if (target.kind === "foreign key") return `ALTER TABLE ${table} DROP FOREIGN KEY ${name};`;
  if (target.kind === "trigger") return `DROP TRIGGER ${ref};`;
  return `DROP ${kindSql(MY, target.kind)?.word ?? "TABLE"} ${ref};`;
}

const LITE = "sqlite";

/** A name in SQLite: the main schema's unqualified, as the plugin writes it everywhere. */
export const sqliteRef = (/** @type {Target} */ target) =>
  qualified(LITE, target.schema === "main" ? "" : target.schema, target.name);

/**
 * SQLite's statement of an operation.
 * @param {AnyOp} op
 * @param {Target} target
 * @param {Facts} facts
 * @param {Answers} answers
 */
export function sqliteScript(op, target, facts, answers) {
  const spec = kindSql(LITE, target.kind);
  if (!spec) throw new Error(`A ${target.kind} is not changed from here on SQLite.`);
  const ref = sqliteRef(target);
  switch (op) {
    case "rename":
      return `ALTER TABLE ${ref} RENAME TO ${quoteName(LITE, newName(LITE, answers.values.to, target.name))};`;
    case "drop":
      if (target.owned)
        throw new Error(
          `${target.name} is the index SQLite made for a key of ${target.table}: it goes only with its table.`,
        );
      return `DROP ${spec.word} ${ref};`;
    case "truncate":
      return `DELETE FROM ${ref};`;
    case "apply":
      return `${sqlitePrefix(target)}${sourceText(facts)}`;
    default:
      throw new Error(`${op} is not on SQLite.`);
  }
}

/** A view is replaced by dropping it first, in the same transaction. */
export const sqlitePrefix = (/** @type {Target} */ target) => `DROP VIEW ${sqliteRef(target)};\n`;
