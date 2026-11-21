// A table's ALTER script (PG-51, ADR 0324): the difference between the table as the server has it
// and as the form holds it, every part matched by its id, in an order that applies. The table's
// rename first; then indexes and constraints that go or change are dropped; columns are dropped,
// renamed and changed (alter-columns.js); constraints and indexes are renamed, and the ones that
// changed or are new are added (a primary key and unique ones before the foreign keys that may
// reference them); CONCURRENTLY indexes after the transaction; comments and the owner last. A
// part the form cannot write (`kept`) is only renamed or dropped. Pure.

import { addedColumns, columnChanges, dropsAndRenames } from "./alter-columns.js";
import {
  columnComment,
  constraintSql,
  indexName,
  indexSql,
  ownerSql,
  q,
  tableComment,
  tableSql,
} from "./ddl.js";
import { byId, sameKeys, sameList } from "./model.js";
import { MARKS } from "./words.js";

/**
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./model.js").Unique} Unique
 * @typedef {import("./model.js").Check} Check
 * @typedef {import("./model.js").ForeignKey} ForeignKey
 * @typedef {import("./model.js").Index} Index
 * @typedef {import("./read.js").Facts} Facts
 * @typedef {import("./alter-columns.js").Step} Step
 * @typedef {{ id: string, name: string, kept?: string }} Part
 * @typedef {"primary" | "unique" | "check" | "foreign"} Kind
 */

/** How each kind of constraint is the same: what it holds, not its name. */
const SAME = {
  primary: (/** @type {Unique} */ a, /** @type {Unique} */ b) => sameList(a.columns, b.columns),
  unique: (/** @type {Unique} */ a, /** @type {Unique} */ b) => sameList(a.columns, b.columns),
  check: (/** @type {Check} */ a, /** @type {Check} */ b) =>
    a.expression.trim() === b.expression.trim(),
  foreign: (/** @type {ForeignKey} */ a, /** @type {ForeignKey} */ b) =>
    sameList(a.columns, b.columns) &&
    a.self === b.self &&
    a.refSchema === b.refSchema &&
    a.refTable === b.refTable &&
    sameList(a.refColumns, b.refColumns) &&
    a.onDelete === b.onDelete &&
    a.onUpdate === b.onUpdate,
};
const sameIndex = (/** @type {Index} */ a, /** @type {Index} */ b) =>
  a.method === b.method &&
  a.unique === b.unique &&
  sameKeys(a.keys, b.keys) &&
  a.where.trim() === b.where.trim();

/**
 * What became of each part: gone, changed (dropped and added again), renamed, or new. A kept part
 * never changes, only its name.
 * @template {Part} T
 * @param {T[]} was
 * @param {T[]} now
 * @param {(a: T, b: T) => boolean} same
 */
function partsOf(was, now, same) {
  const out = {
    gone: /** @type {T[]} */ ([]),
    changed: /** @type {[T, T][]} */ ([]),
    renamed: /** @type {[T, T][]} */ ([]),
    added: /** @type {T[]} */ ([]),
  };
  for (const w of was) {
    const n = /** @type {T | undefined} */ (byId(now, w.id));
    if (!n) out.gone.push(w);
    else if (!w.kept && !same(w, n)) out.changed.push([w, n]);
    else if (w.name !== n.name) out.renamed.push([w, n]);
  }
  for (const n of now) if (!byId(was, n.id)) out.added.push(n);
  return out;
}

/**
 * The ALTER script of an existing table: its steps and what the form will not write as asked.
 * @param {Design} was The table as the server has it.
 * @param {Design} now The form's design of it.
 * @param {Facts} facts
 */
export function alterSteps(was, now, facts) {
  /** @type {Step[]} */
  const steps = [];
  /** @type {string[]} */
  const held = [];
  const table = tableSql(now);
  if (now.name !== was.name)
    steps.push({ sql: `ALTER TABLE ${tableSql(was)} RENAME TO ${q(now.name)}`, marks: [] });

  const one = (/** @type {Unique | null} */ pk) => (pk ? [pk] : []);
  /** @type {[Kind, ReturnType<typeof partsOf<any>>][]} */
  const constraints = [
    ["foreign", partsOf(was.foreignKeys, now.foreignKeys, SAME.foreign)],
    ["check", partsOf(was.checks, now.checks, SAME.check)],
    ["unique", partsOf(was.uniques, now.uniques, SAME.unique)],
    ["primary", partsOf(one(was.primaryKey), one(now.primaryKey), SAME.primary)],
  ];
  const others = partsOf(was.others, now.others, () => true);
  const indexes = partsOf(was.indexes, now.indexes, sameIndex);
  for (const w of [...indexes.gone, ...indexes.changed.map(([a]) => a)])
    steps.push({ sql: `DROP INDEX ${indexName(was, w.name)}`, marks: [] });
  for (const [, parts] of [...constraints, ["other", others]])
    for (const w of [...parts.gone, ...parts.changed.map((/** @type {Part[]} */ [a]) => a)])
      steps.push({ sql: `ALTER TABLE ${table} DROP CONSTRAINT ${q(w.name)}`, marks: [] });

  const columns = dropsAndRenames(table, was, now);
  steps.push(...columns.steps);
  held.push(...columns.held);
  for (const [, parts] of [...constraints, ["other", others]])
    for (const [w, n] of parts.renamed) {
      if (n.name.trim() === "") held.push(`Constraint ${w.name} keeps a name: type one.`);
      steps.push({
        sql: `ALTER TABLE ${table} RENAME CONSTRAINT ${q(w.name)} TO ${q(n.name)}`,
        marks: [],
      });
    }
  for (const [w, n] of indexes.renamed) {
    if (n.name.trim() === "") held.push(`Index ${w.name} keeps a name: type one.`);
    steps.push({ sql: `ALTER INDEX ${indexName(was, w.name)} RENAME TO ${q(n.name)}`, marks: [] });
  }

  const changes = columnChanges(table, was, now, facts);
  steps.push(...changes.steps, ...addedColumns(table, was, now, facts));
  held.push(...changes.held);

  const ADD_MARKS = {
    primary: MARKS.primary,
    unique: MARKS.unique,
    check: MARKS.check,
    foreign: MARKS.foreign,
  };
  for (const kind of /** @type {Kind[]} */ (["primary", "unique", "check", "foreign"])) {
    const parts = constraints.find(([k]) => k === kind)?.[1];
    for (const n of [...(parts?.changed.map(([, b]) => b) ?? []), ...(parts?.added ?? [])])
      steps.push({
        sql: `ALTER TABLE ${table} ADD ${constraintSql(now, kind, n)}`,
        marks: [ADD_MARKS[kind]],
      });
  }
  /** @type {Step[]} */
  const after = [];
  for (const n of [...indexes.changed.map(([, b]) => b), ...indexes.added]) {
    if (n.concurrently)
      after.push({ sql: indexSql(now, n, true), marks: [MARKS.concurrently], concurrent: true });
    else steps.push({ sql: indexSql(now, n), marks: [MARKS.index] });
  }

  if (now.comment !== was.comment) steps.push({ sql: tableComment(now), marks: [] });
  for (const n of now.columns) {
    if (n.dropped) continue;
    const w = /** @type {import("./model.js").Column | undefined} */ (byId(was.columns, n.id));
    if (w ? w.comment !== n.comment : n.comment !== "")
      steps.push({ sql: columnComment(now, n), marks: [] });
  }
  if (now.owner.trim() && now.owner.trim() !== was.owner)
    steps.push({ sql: ownerSql(now), marks: [] });
  return { steps: [...steps, ...after], held };
}
