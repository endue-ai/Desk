// Each engine's reader of what its client printed, by engine id. Only the result worker
// (ui/output-worker.js) loads this folder: the frame's thread never parses a run's output (#38).
import { readMysql } from "./mysql.js";
import { readPostgres } from "./postgres.js";
import { readSqlite } from "./sqlite.js";

/**
 * @typedef {import("../engines/common.js").EngineId} EngineId
 * @typedef {import("../engines/common.js").Outcome} Outcome
 * @typedef {import("../engines/common.js").RunResult} RunResult
 * @typedef {Pick<import("../engines/common.js").Invocation, "statements" | "nonce" | "maxRows">} Reading
 *   what of the plan a reader needs
 */

/** @type {Record<EngineId, (outcome: Outcome, invocation: Reading, timeoutMs: number) => RunResult>} */
const READERS = { postgresql: readPostgres, mysql: readMysql, sqlite: readSqlite };

/**
 * The statements' results, sets cut to `maxRows` rows, from one run's outcome.
 * @param {EngineId} engine
 * @param {Outcome} outcome
 * @param {Reading} invocation
 * @param {number} timeoutMs
 * @returns {RunResult}
 */
export function readOutput(engine, outcome, invocation, timeoutMs) {
  const read = READERS[engine];
  if (!read) throw new Error(`Unknown engine: ${String(engine)}.`);
  return read(outcome, /** @type {never} */ (invocation), timeoutMs);
}
