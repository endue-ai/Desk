// Generate SQL (PG-52): a SELECT, INSERT, UPDATE or DELETE of a table's columns and a call of a
// routine, written into a console for the person to finish and run. Rows are named by the
// primary key where there is one, by every column where there is none; each value is a `:name`
// parameter, so a run asks for it. Names are quoted as the dialect quotes them. Pure.

import { qualified, quoteName } from "../../sql/quote.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {import("../../engines/common.js").EngineId} EngineId
 * @typedef {import("./kinds.js").Target} Target
 * @typedef {import("./sql-postgres.js").Routine} Routine
 * @typedef {{ name: string, primary: boolean }} Column
 * @typedef {"select" | "insert" | "update" | "delete" | "call"} Template
 */

export const TEMPLATES = /** @type {const} */ ({
  select: "SELECT",
  insert: "INSERT",
  update: "UPDATE",
  delete: "DELETE",
  call: "a call",
});

/** Which templates a kind has: a table all four, a view its SELECT, a routine its call. */
export function templatesOf(/** @type {string} */ kind) {
  if (kind === "function" || kind === "procedure") return /** @type {Template[]} */ (["call"]);
  if (kind === "table" || kind === "foreign table")
    return /** @type {Template[]} */ (["select", "insert", "update", "delete"]);
  return /** @type {Template[]} */ (["select"]);
}

/** A parameter's name from a column's or an argument's: letters, digits and _ only. */
export function paramName(/** @type {string} */ name, /** @type {number} */ index) {
  const plain = name.replace(/[^A-Za-z0-9_]/gu, "_").replace(/^(?=\d)/u, "p");
  return plain && /[A-Za-z0-9]/u.test(plain) ? plain : `arg${index + 1}`;
}

/** The table's name as the plugin writes it: SQLite's main unqualified. */
const nameOf = (/** @type {EngineId} */ engine, /** @type {Target} */ target) =>
  qualified(
    engine,
    engine === "sqlite" && target.schema === "main" ? "" : target.schema,
    target.name,
  );

/**
 * A template's text.
 * @param {EngineId} engine
 * @param {Template} which
 * @param {Target} target
 * @param {{ columns?: Column[], routine?: Routine }} read
 */
export function templateOf(engine, which, target, read) {
  if (!templatesOf(target.kind).includes(which))
    throw new Error(
      t("features.objects.templates.aHasNoTemplate", {
        kind: String(target.kind),
        value: String(TEMPLATES[which]),
      }),
    );
  if (which === "call") return callOf(engine, target, read.routine);
  const columns = read.columns ?? [];
  if (columns.length === 0)
    throw new Error(
      t("features.objects.templates.hasNoColumnsToWriteA", { name: String(target.name) }),
    );
  const q = (/** @type {string} */ name) => quoteName(engine, name);
  const from = nameOf(engine, target);
  const equals = (/** @type {Column} */ c, /** @type {number} */ i) =>
    `${q(c.name)} = :${paramName(c.name, i)}`;
  const keys = columns.some((c) => c.primary) ? columns.filter((c) => c.primary) : columns;
  const where = `WHERE ${keys.map((c) => equals(c, columns.indexOf(c))).join(" AND ")}`;
  if (which === "select")
    return `SELECT ${columns.map((c) => q(c.name)).join(", ")}\nFROM ${from}\nLIMIT 100;\n`;
  if (which === "insert")
    return `INSERT INTO ${from} (${columns.map((c) => q(c.name)).join(", ")})\nVALUES (${columns
      .map((c, i) => `:${paramName(c.name, i)}`)
      .join(", ")});\n`;
  if (which === "delete") return `DELETE FROM ${from}\n${where};\n`;
  const set = columns.filter((c) => !keys.includes(c) || keys === columns);
  return `UPDATE ${from}\nSET ${set.map((c) => equals(c, columns.indexOf(c))).join(",\n    ")}\n${where};\n`;
}

/** A call of a routine: SELECT * FROM a function, CALL a procedure, OUT arguments as NULL (@name on MySQL). */
function callOf(
  /** @type {EngineId} */ engine,
  /** @type {Target} */ target,
  /** @type {Routine | undefined} */ routine,
) {
  if (!routine)
    throw new Error(
      t("features.objects.templates.theArgumentsOfWereNotRead", { name: String(target.name) }),
    );
  const procedure = target.kind === "procedure";
  const args = routine.params.flatMap((p, i) => {
    if (p.mode === "out" && !procedure) return [];
    if (p.mode === "out") return [engine === "mysql" ? `@${paramName(p.name, i)}` : "NULL"];
    return [`:${paramName(p.name, i)}`];
  });
  const name = qualified(engine, target.schema, routine.name);
  const call = `${name}(${args.join(", ")})`;
  if (procedure) return `CALL ${call};\n`;
  return engine === "postgresql" ? `SELECT * FROM ${call};\n` : `SELECT ${call};\n`;
}
