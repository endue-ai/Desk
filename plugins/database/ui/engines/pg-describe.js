// A check without running (PG-21, ADR 0353): each statement of a run in the "describe" mode goes to
// db.describe, which sends Parse and Describe and never executes it, and answers the type the server
// infers for each parameter, the columns it would answer, or the server's error with its position.
// The types' names come from format_type on the same session, the OIDs bound as one value. On a
// console's session in an open transaction it runs under a savepoint, so a statement that does not
// parse leaves the person's transaction as it was. No DOM.

import { placed } from "../editor/bind.js";
import { errorOf } from "./pg-result.js";

/**
 * @typedef {import("./common.js").DbError} DbError
 * @typedef {import("./common.js").RunResult} RunResult
 * @typedef {import("./common.js").StatementOutcome} StatementOutcome
 * @typedef {import("../editor/bind.js").Bound} Bound
 * @typedef {import("./pg-script.js").Job} Job
 * @typedef {import("./pg-script.js").Plan} Plan
 * @typedef {import("@endue-ai/bridge").DbTransaction} Transaction
 * @typedef {{ key: string, oid: number, type: string }} Taken
 * @typedef {{ name: string, oid: number, type: string }} Answered
 * @typedef {{ params: Taken[], columns: Answered[] | null }} Described
 *   `columns` null: the statement answers no rows (NoData).
 */

export const SAVEPOINT = "endue_desk_check";
/** The names of type OIDs, the OIDs bound as one oid[] value. */
export const NAMES_SQL =
  "SELECT t.oid::text, pg_catalog.format_type(t.oid, NULL) FROM pg_catalog.pg_type t WHERE t.oid = ANY($1)";
const OID_ARRAY = 1028;

const textOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/** A check's answer as a result set: what it takes and what it answers, a row each. */
export function setOfDescribed(/** @type {Described} */ described) {
  return {
    columns: ["part", "name", "type"],
    rows: [
      ...described.params.map((p) => ["parameter", p.key, p.type]),
      ...(described.columns ?? []).map((c) => ["column", c.name, c.type]),
    ],
    truncated: false,
  };
}

/**
 * @param {{
 *   call(method: string, params: Record<string, unknown>): Promise<any>,
 *   own(job: Job, sql: string, notices: string[]): Promise<DbError | undefined>,
 * }} deps
 */
export function createDescribe({ call, own }) {
  /** Names of `oids` by OID; a failure leaves the OID as its name. */
  const names = async (/** @type {Job} */ job, /** @type {number[]} */ oids) => {
    /** @type {Map<number, string>} */
    const named = new Map();
    const wanted = [...new Set(oids.filter((oid) => oid > 0))];
    if (wanted.length === 0) return named;
    const page = await call("db.run", {
      sessionId: job.sessionId,
      sql: NAMES_SQL,
      params: [`{${wanted.join(",")}}`],
      paramTypes: [OID_ARRAY],
    }).catch(() => undefined);
    if (page?.transaction) job.transaction = page.transaction;
    for (const [oid, name] of page?.rows ?? []) named.set(Number(oid), name ?? "");
    return named;
  };

  /** One statement: its outcome, `described` on it when the server answered. */
  const one = async (
    /** @type {Job} */ job,
    /** @type {Bound} */ statement,
    /** @type {number} */ index,
  ) => {
    /** @type {StatementOutcome & { described?: Described }} */
    const outcome = { index, ran: true, sets: [], affected: null, warnings: 0, notices: [] };
    job.running = true;
    try {
      const answer = await call("db.describe", {
        sessionId: job.sessionId,
        sql: statement.text,
        ...(statement.paramTypes?.some((t) => t > 0) ? { paramTypes: statement.paramTypes } : {}),
      });
      if (answer.transaction) job.transaction = answer.transaction;
      if (answer.error)
        return placed(statement, { ...outcome, error: errorOf(answer.error, statement.text) });
      /** @type {number[]} */
      const oids = answer.paramTypes ?? [];
      const columns = answer.columns ?? null;
      const named = await names(job, [
        ...oids,
        ...(columns ?? []).map((/** @type {any} */ c) => c.typeOid),
      ]);
      const nameOf = (/** @type {number} */ oid) => named.get(oid) || String(oid);
      /** @type {Described} */
      const described = {
        params: oids.map((oid, i) => ({
          key: statement.keys?.[i] ?? `$${i + 1}`,
          oid,
          type: nameOf(oid),
        })),
        columns: columns
          ? columns.map((/** @type {any} */ c) => ({
              name: c.name,
              oid: c.typeOid,
              type: nameOf(c.typeOid),
            }))
          : null,
      };
      // An agent's check answers data, not a table: its sets stay empty (features/audit/).
      return { ...outcome, described, sets: job.agent ? [] : [setOfDescribed(described)] };
    } catch (failure) {
      return {
        ...outcome,
        ran: false,
        error: /** @type {DbError} */ ({ kind: "client", message: textOf(failure) }),
      };
    } finally {
      job.running = false;
    }
  };

  /**
   * The plan's statements described on the job's session, the session's transaction `before`.
   * @param {Job} job @param {Plan} plan @param {Transaction} before @param {string[]} notices
   * @param {StatementOutcome[]} outcomes
   * @returns {Promise<DbError | undefined>}
   */
  const describe = async (job, plan, before, notices, outcomes) => {
    const nested = before === "open";
    if (nested) {
      const begun = await own(job, `SAVEPOINT ${SAVEPOINT}`, notices);
      if (begun) return begun;
    }
    for (const [index, statement] of plan.statements.entries()) {
      if (job.cancelled) break;
      outcomes[index] = await one(job, statement, index);
    }
    if (nested && job.transaction !== "idle") {
      await own(job, `ROLLBACK TO SAVEPOINT ${SAVEPOINT}`, notices);
      await own(job, `RELEASE SAVEPOINT ${SAVEPOINT}`, notices);
    }
    return undefined;
  };

  return { describe };
}
