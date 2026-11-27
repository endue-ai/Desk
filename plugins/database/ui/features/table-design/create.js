// A new table's script (PG-51): one CREATE TABLE with its columns, primary key, unique and check
// constraints and foreign keys (to another table or to itself) and its partitioning, then its
// indexes, its comments and its owner, every identifier quoted. Pure.

import {
  columnComment,
  columnSql,
  constraintSql,
  indexSql,
  keyList,
  ownerSql,
  tableComment,
  tableSql,
} from "./ddl.js";
import { living } from "./model.js";
import { MARKS } from "./words.js";

/**
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./read.js").Facts} Facts
 * @typedef {import("./alter-columns.js").Step} Step
 */

/**
 * @param {Design} design
 * @param {Facts} facts
 * @returns {Step[]}
 */
export function createSteps(design, facts) {
  const lines = living(design).map((c) => columnSql(facts.types, c));
  if (design.primaryKey) lines.push(constraintSql(design, "primary", design.primaryKey));
  for (const u of design.uniques) lines.push(constraintSql(design, "unique", u));
  for (const c of design.checks) lines.push(constraintSql(design, "check", c));
  for (const fk of design.foreignKeys) lines.push(constraintSql(design, "foreign", fk));
  const { by, keys } = design.partition;
  const partition = by ? ` PARTITION BY ${by.toUpperCase()} ${keyList(design, keys)}` : "";
  const body = lines.length ? `\n    ${lines.join(",\n    ")}\n` : "";
  /** @type {Step[]} */
  const steps = [
    {
      sql: `CREATE TABLE ${tableSql(design)} (${body})${partition}`,
      marks: by ? [MARKS.partitioned] : [],
    },
  ];
  for (const index of design.indexes) steps.push({ sql: indexSql(design, index), marks: [] });
  if (design.comment) steps.push({ sql: tableComment(design), marks: [] });
  for (const c of living(design))
    if (c.comment) steps.push({ sql: columnComment(design, c), marks: [] });
  if (design.owner.trim()) steps.push({ sql: ownerSql(design), marks: [] });
  return steps;
}
