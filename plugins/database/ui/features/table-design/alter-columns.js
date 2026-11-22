// The column steps of a table's ALTER script (PG-51, ADR 0324), written from the difference between
// the columns as the server has them and as the form holds them, matched by id: dropped columns,
// renames (in an order that applies; names taken in a cycle are refused), then each column's changes
// in an order that applies (an identity, a generation or a default dropped before its type changes,
// every type change in one ALTER TABLE so the table is rewritten once, then the default, NOT NULL and
// an identity), then the new columns. What the form cannot write safely is `held` in words. Pure.

import { columnSql, q } from "./ddl.js";
import { byId } from "./model.js";
import { changeOf, typeSql } from "./types.js";
import { converts, dropsColumn, MARKS, needsUsing } from "./words.js";

/**
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./model.js").Column} Column
 * @typedef {import("./read.js").Facts} Facts
 * @typedef {{ sql: string, marks: string[], concurrent?: boolean }} Step
 * @typedef {{ steps: Step[], held: string[] }} Out
 */

const CALL = /[A-Za-z_][\w.]*\s*\(/u;

/** Each existing column with its edited self, kept in the server's order. */
const pairsOf = (/** @type {Design} */ was, /** @type {Design} */ now) =>
  was.columns.flatMap((w) => {
    const n = /** @type {Column | undefined} */ (byId(now.columns, w.id));
    return n ? [{ w, n }] : [{ w, n: { ...w, dropped: true } }];
  });

/**
 * The renames in an order that applies: one goes when no column holds its new name any more.
 * @param {{ from: string, to: string }[]} renames
 * @param {string[]} names The columns' names once the dropped ones are gone.
 */
export function renameOrder(renames, names) {
  const holding = new Set(names);
  /** @type {{ from: string, to: string }[]} */
  const ordered = [];
  let pending = [...renames];
  while (pending.length) {
    const ready = pending.find((r) => !holding.has(r.to));
    if (!ready) return { ordered: [...ordered, ...pending], cycle: pending };
    holding.delete(ready.from);
    holding.add(ready.to);
    ordered.push(ready);
    pending = pending.filter((r) => r !== ready);
  }
  return { ordered, cycle: [] };
}

/**
 * Drops and renames: what goes before the columns change.
 * @param {string} table The table, quoted, by its new name.
 * @param {Design} was
 * @param {Design} now
 * @returns {Out}
 */
export function dropsAndRenames(table, was, now) {
  const out = /** @type {Out} */ ({ steps: [], held: [] });
  const pairs = pairsOf(was, now);
  for (const { w, n } of pairs)
    if (n.dropped)
      out.steps.push({
        sql: `ALTER TABLE ${table} DROP COLUMN ${q(w.name)}`,
        marks: [dropsColumn(w.name)],
      });
  const kept = pairs.filter(({ n }) => !n.dropped);
  const renames = kept
    .filter(({ w, n }) => w.name !== n.name)
    .map(({ w, n }) => ({ from: w.name, to: n.name }));
  const { ordered, cycle } = renameOrder(
    renames,
    kept.map(({ w }) => w.name),
  );
  if (cycle.length)
    out.held.push(
      `Columns ${cycle.map((r) => r.from).join(" and ")} take each other's names: rename one to another name first, run it, then the rest.`,
    );
  for (const r of ordered)
    out.steps.push({
      sql: `ALTER TABLE ${table} RENAME COLUMN ${q(r.from)} TO ${q(r.to)}`,
      marks: [],
    });
  return out;
}

/**
 * Each existing column's changes, by its new name.
 * @param {string} table
 * @param {Design} was
 * @param {Design} now
 * @param {Facts} facts
 * @returns {Out}
 */
export function columnChanges(table, was, now, facts) {
  const out = /** @type {Out} */ ({ steps: [], held: [] });
  const alter = (
    /** @type {Column} */ n,
    /** @type {string} */ action,
    marks = /** @type {string[]} */ ([]),
  ) => out.steps.push({ sql: `ALTER TABLE ${table} ALTER COLUMN ${q(n.name)} ${action}`, marks });
  const pairs = pairsOf(was, now).filter(({ n }) => !n.dropped);
  // Before a type changes: an identity, a generation or a default that goes.
  for (const { w, n } of pairs) {
    if (w.identity && !n.identity) alter(n, "DROP IDENTITY");
    if (w.generated && !n.generated.trim()) {
      if (facts.version && facts.version < 130000)
        out.held.push(`Column ${n.name} stops being generated only from PostgreSQL 13 on.`);
      alter(n, "DROP EXPRESSION");
    }
    if (w.default && !n.default.trim()) alter(n, "DROP DEFAULT");
  }
  // Every type change in one statement: the table is rewritten once.
  const types = [];
  /** @type {string[]} */
  const failing = [];
  let rewrites = false;
  for (const { w, n } of pairs) {
    const from = typeSql(facts.types, w);
    const to = typeSql(facts.types, n);
    if (from === to) continue;
    const change = changeOf(facts, w, n);
    if (change === "using") out.held.push(needsUsing(n.name, from, to));
    if (change !== "binary") {
      rewrites = true;
      failing.push(n.name);
    }
    types.push(`ALTER COLUMN ${q(n.name)} TYPE ${to}`);
  }
  if (types.length)
    out.steps.push({
      sql: `ALTER TABLE ${table} ${types.join(", ")}`,
      marks: rewrites ? [MARKS.rewrite, converts(failing)] : [],
    });
  for (const { w, n } of pairs) {
    const value = n.default.trim();
    if (value && value !== w.default.trim()) alter(n, `SET DEFAULT ${value}`);
    const notNull = !n.nullable || Boolean(n.identity);
    if (notNull && w.nullable) alter(n, "SET NOT NULL", [MARKS.notNull]);
    if (!notNull && !w.nullable) alter(n, "DROP NOT NULL");
    if (n.identity && !w.identity)
      alter(n, `ADD GENERATED ${n.identity.toUpperCase()} AS IDENTITY`, [MARKS.identity]);
    if (n.identity && w.identity && n.identity !== w.identity)
      alter(n, `SET GENERATED ${n.identity.toUpperCase()}`);
    const expression = n.generated.trim();
    if (expression && !w.generated)
      out.held.push(
        `Column ${n.name} becomes generated only as it is added: drop it and add a new one (its values go).`,
      );
    else if (expression && expression !== w.generated.trim()) {
      if (facts.version && facts.version < 170000)
        out.held.push(
          `Column ${n.name}'s generation changes in place only from PostgreSQL 17 on: drop it and add a new one.`,
        );
      alter(n, `SET EXPRESSION AS (${expression})`, [MARKS.rewrite]);
    }
  }
  return out;
}

/**
 * The new columns, at the end of the table as PostgreSQL adds them.
 * @param {string} table
 * @param {Design} was
 * @param {Design} now
 * @param {Facts} facts
 * @returns {Step[]}
 */
export function addedColumns(table, was, now, facts) {
  return now.columns
    .filter((c) => !c.dropped && !byId(was.columns, c.id))
    .map((c) => {
      const marks = [];
      if (c.identity || c.generated.trim()) marks.push(MARKS.rewrite);
      else if (CALL.test(c.default)) marks.push(MARKS.volatile);
      if (!c.nullable && !c.identity && !c.generated.trim() && !c.default.trim())
        marks.push(MARKS.newNotNull);
      return { sql: `ALTER TABLE ${table} ADD COLUMN ${columnSql(facts.types, c)}`, marks };
    });
}
