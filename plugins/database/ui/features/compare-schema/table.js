// A table of the comparison (PG-53, ADR 0338): its DDL written by the table form's writer (PG-51's
// createSteps: CREATE TABLE with its columns and keys, its indexes and comments), the parts that form
// cannot write (`kept`) added from their own definitions and the partition key after; and what two
// tables are compared by, which leaves out formatting, the order of columns and parts, and the names
// PostgreSQL makes up for a constraint or an index. Pure.

import { qualified, quoteName } from "../../sql/quote.js";
import { constraintSql } from "../table-design/ddl.js";
import { createSteps } from "../table-design/create.js";
import { nameOf } from "../table-design/model.js";
import { norm } from "./normalize.js";

/**
 * @typedef {import("./model.js").Obj} Obj
 * @typedef {import("../table-design/model.js").Design} Design
 * @typedef {import("../table-design/read.js").Facts} Facts
 * @typedef {import("../table-design/alter-columns.js").Step} Step
 * @typedef {{ kind: "constraint" | "index", name: string, sql: string }} Kept
 */

const PG = "postgresql";
const GENERATED = /_(pkey|key|fkey|check|idx|excl|not_null)\d*$/u;

/** Whether a part's name is one PostgreSQL makes up (or none was written). */
export const generatedName = (/** @type {string} */ name, /** @type {string} */ table) =>
  name.trim() === "" || (name.startsWith(`${table}_`) && GENERATED.test(name));

/** A design without the parts the form cannot write, and those parts' DDL. */
export function withoutKept(/** @type {Design} */ design) {
  /** @type {Kept[]} */
  const kept = [];
  const table = qualified(PG, design.schema, design.name);
  const keep = (
    /** @type {{ name: string, kept?: string }} */ part,
    /** @type {Kept["kind"]} */ kind,
  ) => {
    if (part.kept === undefined) return true;
    kept.push({
      kind,
      name: part.name,
      sql:
        kind === "index"
          ? part.kept
          : `ALTER TABLE ${table} ADD CONSTRAINT ${quoteName(PG, part.name)} ${part.kept}`,
    });
    return false;
  };
  const plain = {
    ...design,
    primaryKey:
      design.primaryKey && keep(design.primaryKey, "constraint") ? design.primaryKey : null,
    uniques: design.uniques.filter((p) => keep(p, "constraint")),
    checks: design.checks.filter((p) => keep(p, "constraint")),
    foreignKeys: design.foreignKeys.filter((p) => keep(p, "constraint")),
    indexes: design.indexes.filter((p) => keep(p, "index")),
    others: design.others.filter((p) => keep(p, "constraint")),
  };
  return { design: plain, kept };
}

/**
 * A table's CREATE steps; its foreign keys left out when `foreignKeys` is false (they are added
 * after every new table, `foreignSteps`).
 * @param {Obj} obj
 * @param {Facts} facts
 * @param {{ foreignKeys?: boolean }} [how]
 * @returns {Step[]}
 */
export function tableSteps(obj, facts, { foreignKeys = true } = {}) {
  const { design, kept } = withoutKept(/** @type {Design} */ (obj.table));
  const steps = createSteps(foreignKeys ? design : { ...design, foreignKeys: [] }, facts);
  const first = steps[0];
  if (first && obj.partition) first.sql = `${first.sql} PARTITION BY ${obj.partition}`;
  for (const k of kept) steps.push({ sql: k.sql, marks: [] });
  return steps;
}

/** The foreign keys of a new table, each an ALTER TABLE ... ADD. */
export function foreignSteps(/** @type {Obj} */ obj, /** @type {string[]} */ marks) {
  const { design } = withoutKept(/** @type {Design} */ (obj.table));
  const table = qualified(PG, design.schema, design.name);
  return design.foreignKeys.map((fk) => ({
    sql: `ALTER TABLE ${table} ADD ${constraintSql(design, "foreign", fk)}`,
    marks,
  }));
}

/** A table's DDL as shown and dumped: its statements, each ending with `;`. */
export const tableDdl = (/** @type {Obj} */ obj, /** @type {Facts} */ facts) =>
  `${tableSteps(obj, facts)
    .map((s) => `${s.sql};`)
    .join("\n\n")}\n`;

/** A column's type as compared: the schema's own types without the schema. */
const typeText = (/** @type {import("../table-design/model.js").Column} */ c, /** @type {string} */ schema) =>
  `${c.type.startsWith(`${schema}.`) ? c.type.slice(schema.length + 1) : c.type}${c.length.trim() ? `(${c.length.replace(/\s+/gu, "")})` : ""}${c.array ? "[]" : ""}`;

/** What a constraint or an index holds, by its columns' names, without its name. */
export function partKey(
  /** @type {Design} */ d,
  /** @type {"primary" | "unique" | "check" | "foreign" | "index" | "other"} */ kind,
  /** @type {any} */ part,
  /** @type {string} */ schema,
) {
  if (part.kept !== undefined) return `${kind} kept ${norm(part.kept, schema)}`;
  const cols = (/** @type {string[]} */ ids) => ids.map((id) => nameOf(d, id)).join(",");
  if (kind === "primary" || kind === "unique") return `${kind} ${cols(part.columns)}`;
  if (kind === "check") return `check ${norm(part.expression, schema)}`;
  if (kind === "foreign") {
    const ref = part.self
      ? ""
      : `${part.refSchema === schema ? "" : part.refSchema}.${part.refTable}`;
    const refCols = part.self ? cols(part.refColumns) : part.refColumns.join(",");
    return `foreign ${cols(part.columns)} ${ref}(${refCols}) ${part.onDelete} ${part.onUpdate}`;
  }
  const keys = part.keys
    .map((/** @type {{ column: string, expression: string }} */ k) =>
      k.column ? nameOf(d, k.column) : `(${norm(k.expression, schema)})`,
    )
    .join(",");
  return `index ${part.method} ${part.unique} ${keys} ${norm(part.where, schema)}`;
}

/** Every part of a design with its kind. */
export function partsOf(/** @type {Design} */ d) {
  return [
    ...(d.primaryKey ? [{ kind: /** @type {const} */ ("primary"), part: d.primaryKey }] : []),
    ...d.uniques.map((part) => ({ kind: /** @type {const} */ ("unique"), part })),
    ...d.checks.map((part) => ({ kind: /** @type {const} */ ("check"), part })),
    ...d.foreignKeys.map((part) => ({ kind: /** @type {const} */ ("foreign"), part })),
    ...d.indexes.map((part) => ({ kind: /** @type {const} */ ("index"), part })),
    ...d.others.map((part) => ({ kind: /** @type {const} */ ("other"), part })),
  ];
}

/** What a table is compared by: equal for two tables that differ only in what is no difference. */
export function tableSignature(/** @type {Obj} */ obj, /** @type {string} */ schema) {
  const d = /** @type {Design} */ (obj.table);
  const columns = d.columns
    .filter((c) => !c.dropped)
    .map(
      (c) =>
        `${c.name} ${typeText(c, schema)} ${c.nullable && !c.identity ? "" : "not null"} ${norm(c.default, schema)} ${c.identity} ${norm(c.generated, schema)} ${c.comment}`,
    )
    .sort();
  const parts = partsOf(d)
    .map(({ kind, part }) => {
      const named = generatedName(part.name, d.name) ? "" : ` as ${part.name}`;
      return `${partKey(d, kind, part, schema)}${named}`;
    })
    .sort();
  return [...columns, "--", ...parts, "--", d.comment, norm(obj.partition ?? "", schema)].join(
    "\n",
  );
}
