// A constraint the table form keeps as written (PG-51 keeps every one it cannot be sure of, and
// PostgreSQL 17 marks a primary key and a foreign key as not inherited) read again from its
// definition (PG-53): when it reads as a plain one (no DEFERRABLE, NOT VALID, NO INHERIT ...), it is
// compared and written as that, so a server's table and the same table in a file are one. Pure.

import { addConstraint } from "./parse-table.js";

/** @typedef {import("../table-design/model.js").Design} Design */

/**
 * A design whose kept constraints are plain parts where their definition reads as one.
 * @param {Design} design
 * @param {string} schema The schema an unqualified table it references is in.
 * @returns {Design}
 */
export function plainOf(design, schema) {
  const ctx = { schema, ours: new Set(), seq: { n: 0 } };
  const empty = {
    ...design,
    primaryKey: null,
    uniques: [],
    checks: [],
    foreignKeys: [],
    others: [],
  };
  /** The plain part a kept one reads as, under its own id and name; undefined when it does not. */
  const read = (
    /** @type {{ id: string, name: string, kept?: string }} */ part,
    /** @type {"primaryKey" | "uniques" | "checks" | "foreignKeys"} */ list,
  ) => {
    if (part.kept === undefined) return part;
    /** @type {Design} */
    const scratch = structuredClone(empty);
    try {
      addConstraint(scratch, part.name, part.kept, ctx);
    } catch {
      return part;
    }
    const got = list === "primaryKey" ? scratch.primaryKey : scratch[list][0];
    if (!got || got.kept !== undefined || got.columns?.includes?.("")) return part;
    return { ...got, id: part.id, name: part.name };
  };
  return {
    ...design,
    primaryKey: design.primaryKey && /** @type {any} */ (read(design.primaryKey, "primaryKey")),
    uniques: design.uniques.map((p) => /** @type {any} */ (read(p, "uniques"))),
    checks: design.checks.map((p) => /** @type {any} */ (read(p, "checks"))),
    foreignKeys: design.foreignKeys.map((p) => /** @type {any} */ (read(p, "foreignKeys"))),
  };
}
