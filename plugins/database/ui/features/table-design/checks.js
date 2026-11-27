// What must hold before the table form writes a part (PG-51): names there and at most PostgreSQL's
// 63 bytes, column names that differ, types of the server's with a length they take, one expression
// where an expression goes (no `;`, no comment, balanced parentheses), keys with columns that stay,
// a foreign key with as many columns as it references, a unique index on btree, a partitioned table
// whose keys hold its partition columns, an owner that is a role. Each problem is a sentence; the
// script waits while any is there. Pure.

import { oneExpression } from "../../catalog.js";
import { t } from "../../strings/index.js";
import { living, nameOf } from "./model.js";
import { INTEGERS, typeOf, typeProblem } from "./types.js";

/**
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./model.js").Column} Column
 * @typedef {import("./model.js").Key} Key
 * @typedef {import("./read.js").Facts} Facts
 */

const MAX = 63;
const bytes = (/** @type {string} */ name) => new TextEncoder().encode(name).length;

/** How a column is said: its name, else its place. */
export const columnLabel = (/** @type {Design} */ design, /** @type {Column} */ column) =>
  column.name.trim()
    ? t("features.tableDesign.checks.column", { name: String(column.name) })
    : t("features.tableDesign.checks.column2", {
        value: String(design.columns.indexOf(column) + 1),
      });

/** A part's name problem ("" when none), `required` for a table or a column. */
function nameProblem(/** @type {string} */ name, /** @type {string} */ what, required = false) {
  if (required && name.trim() === "")
    return t("features.tableDesign.checks.hasNoName", { what: String(what) });
  if (bytes(name) > MAX)
    return t("features.tableDesign.checks.sNameIsLongerThanPostgresql", {
      what: String(what),
      MAX: String(MAX),
    });
  return "";
}

/** An expression's problem ("" when it is one expression, or empty and allowed). */
function expressionProblem(/** @type {string} */ expression, /** @type {string} */ what) {
  if (expression.trim() === "")
    return t("features.tableDesign.checks.isEmpty", { what: String(what) });
  return oneExpression(expression)
    ? ""
    : t("features.tableDesign.checks.isNotOneExpressionItHolds", { what: String(what) });
}

/** The problems of a list of keys (an index's, a partition's). */
function keysProblems(
  /** @type {Design} */ design,
  /** @type {Key[]} */ keys,
  /** @type {string} */ what,
) {
  if (keys.length === 0)
    return [t("features.tableDesign.checks.hasNoColumnsOrExpressions", { what: String(what) })];
  return keys.flatMap((k) =>
    k.column
      ? columnProblem(design, k.column, what)
      : [expressionProblem(k.expression, `An expression of ${what}`)],
  );
}

/** A key's column that is gone or dropped. */
function columnProblem(
  /** @type {Design} */ design,
  /** @type {string} */ id,
  /** @type {string} */ what,
) {
  const column = design.columns.find((c) => c.id === id);
  if (!column)
    return [t("features.tableDesign.checks.namesAColumnThatIsGone", { what: String(what) })];
  // The server would drop the part with the column; the form has the person say so.
  return column.dropped
    ? [
        t("features.tableDesign.checks.holdsWhichIsDroppedRemoveIt", {
          what: String(what),
          name: String(column.name),
        }),
      ]
    : [];
}

/** A column's own problems. */
function columnProblems(
  /** @type {Design} */ design,
  /** @type {Column} */ column,
  /** @type {Facts} */ facts,
) {
  const label = columnLabel(design, column);
  const Label = label.charAt(0).toUpperCase() + label.slice(1);
  const out = [nameProblem(column.name, Label, true)];
  const type = typeProblem(facts.types, column);
  if (type) out.push(`${Label} ${type}`);
  const valued = [column.default.trim(), column.generated.trim(), column.identity].filter(Boolean);
  if (valued.length > 1)
    out.push(t("features.tableDesign.checks.canHaveOneOfADefault", { Label: String(Label) }));
  if (column.default.trim()) out.push(expressionProblem(column.default, `The default of ${label}`));
  if (column.generated.trim())
    out.push(expressionProblem(column.generated, `The generation of ${label}`));
  const integer = INTEGERS.has(typeOf(facts.types, column.type)?.label ?? "");
  if (column.identity && (column.array || !integer))
    out.push(
      t("features.tableDesign.checks.isAnIdentityThatTakesSmallint", { Label: String(Label) }),
    );
  return out;
}

/**
 * Every problem of a design, in the form's order; `[]` when it can be written.
 * @param {Design} design
 * @param {Facts} facts
 */
export function problemsOf(design, facts) {
  const out = [nameProblem(design.name, "The table", true)];
  const columns = living(design);
  const seen = new Set();
  for (const column of columns) {
    out.push(...columnProblems(design, column, facts));
    if (column.name && seen.has(column.name))
      out.push(
        t("features.tableDesign.checks.twoColumnsAreNamedRenameOne", { name: String(column.name) }),
      );
    seen.add(column.name);
  }
  const keyed = (
    /** @type {{ name: string, columns: string[] }} */ key,
    /** @type {string} */ what,
  ) => [
    nameProblem(key.name, what),
    ...(key.columns.length
      ? []
      : [t("features.tableDesign.checks.hasNoColumns", { what: String(what) })]),
    ...key.columns.flatMap((id) => columnProblem(design, id, what)),
  ];
  const pk = design.primaryKey;
  if (pk && !pk.kept) out.push(...keyed(pk, "The primary key"));
  for (const u of design.uniques)
    if (!u.kept) out.push(...keyed(u, `Unique constraint ${u.name || "(no name)"}`));
  for (const c of design.checks) {
    const what = `Check ${c.name || "(no name)"}`;
    if (!c.kept) out.push(nameProblem(c.name, what), expressionProblem(c.expression, what));
  }
  for (const fk of design.foreignKeys) if (!fk.kept) out.push(...foreignProblems(design, fk));
  for (const index of design.indexes) {
    if (index.kept) continue;
    const what = `Index ${index.name || "(no name)"}`;
    out.push(nameProblem(index.name, what), ...keysProblems(design, index.keys, what));
    if (facts.methods.length && !facts.methods.includes(index.method))
      out.push(
        t("features.tableDesign.checks.usesWhichThisServerDoesNot", {
          what: String(what),
          value: String(index.method || t("features.tableDesign.checks.noMethod")),
        }),
      );
    if (index.unique && index.method !== "btree")
      out.push(t("features.tableDesign.checks.onlyABtreeIndexIsUnique", { what: String(what) }));
    if (index.where.trim()) out.push(expressionProblem(index.where, `The WHERE of ${what}`));
  }
  out.push(...partitionProblems(design));
  const owner = design.owner.trim();
  if (owner && facts.roles.length && !facts.roles.includes(owner))
    out.push(t("features.tableDesign.checks.thereIsNoRoleOnThis", { owner: String(owner) }));
  return out.filter(Boolean);
}

/** A foreign key's problems. */
function foreignProblems(
  /** @type {Design} */ design,
  /** @type {import("./model.js").ForeignKey} */ fk,
) {
  const what = `Foreign key ${fk.name || "(no name)"}`;
  const out = [nameProblem(fk.name, what)];
  if (fk.columns.length === 0)
    out.push(t("features.tableDesign.checks.hasNoColumns", { what: String(what) }));
  out.push(...fk.columns.flatMap((id) => columnProblem(design, id, what)));
  if (!fk.self && (!fk.refSchema || !fk.refTable))
    out.push(t("features.tableDesign.checks.referencesNoTable", { what: String(what) }));
  if (fk.refColumns.length === 0)
    out.push(t("features.tableDesign.checks.referencesNoColumns", { what: String(what) }));
  else if (fk.refColumns.length !== fk.columns.length)
    out.push(
      t("features.tableDesign.checks.hasColumnsAndReferencesMakeThem", {
        what: String(what),
        length: String(fk.columns.length),
        length2: String(fk.refColumns.length),
      }),
    );
  if (fk.self) out.push(...fk.refColumns.flatMap((id) => columnProblem(design, id, what)));
  return out;
}

/** A partitioned table's problems: keys, and unique keys that hold its partition columns. */
function partitionProblems(/** @type {Design} */ design) {
  const { by, keys } = design.partition;
  if (!by) return [];
  const out = keysProblems(design, keys, "The partition key");
  const unique = [
    ...(design.primaryKey ? [{ what: "The primary key", key: design.primaryKey }] : []),
    ...design.uniques.map((u) => ({ what: `Unique constraint ${u.name || "(no name)"}`, key: u })),
  ];
  for (const { what, key } of unique) {
    if (keys.some((k) => !k.column))
      out.push(t("features.tableDesign.checks.cannotGoWithAPartitionKey", { what: String(what) }));
    const missing = keys.filter((k) => k.column && !key.columns.includes(k.column));
    if (missing.length)
      out.push(
        t("features.tableDesign.checks.mustHoldThePartitionColumns", {
          what: String(what),
          value: String(missing.map((k) => nameOf(design, k.column)).join(", ")),
        }),
      );
  }
  return out;
}
