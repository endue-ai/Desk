// The script of an operation on each engine (PG-52): the one function the dialog calls as the
// person types and the controller calls before the run, so what is shown is what runs. A source
// edit's script is what runs before the console's text and then the text itself; it runs in one
// transaction where the engine's DDL can roll back (PostgreSQL, SQLite), as it is on MySQL. Pure.

import { notOffered } from "./kinds.js";
import { mysqlScript, sqlitePrefix, sqliteScript } from "./sql-other.js";
import { postgresPrefix, postgresScript } from "./sql-postgres.js";

/**
 * @typedef {import("../../engines/common.js").EngineId} EngineId
 * @typedef {import("./kinds.js").Target} Target
 * @typedef {import("./sql-postgres.js").AnyOp} AnyOp
 * @typedef {import("./sql-postgres.js").Facts} Facts
 * @typedef {import("./sql-postgres.js").Answers} Answers
 */

const SCRIPTS = { postgresql: postgresScript, mysql: mysqlScript, sqlite: sqliteScript };

/**
 * The script an operation runs; an Error says what is wrong with the answers.
 * @param {EngineId} engine
 * @param {AnyOp} op
 * @param {Target} target
 * @param {Facts} facts
 * @param {Partial<Answers>} [answers]
 */
export function scriptOf(engine, op, target, facts, answers = {}) {
  if (op !== "apply") {
    const refused = notOffered(engine, op, target);
    if (refused) throw new Error(refused);
  }
  return SCRIPTS[engine](op, target, facts, {
    values: answers.values ?? {},
    choices: answers.choices ?? [],
  });
}

/** What a source edit runs before the console's text, on its first line(s). */
export function applyPrefix(
  /** @type {EngineId} */ engine,
  /** @type {Target} */ target,
  /** @type {Facts} */ facts,
) {
  if (engine === "postgresql") return postgresPrefix(target, facts);
  return engine === "sqlite" ? sqlitePrefix(target) : "";
}

/** How a script runs: in one transaction where the engine can roll DDL back. */
export const modeOf = (/** @type {EngineId} */ engine) =>
  /** @type {import("../../execute.js").Mode} */ (engine === "mysql" ? "run" : "transaction");
