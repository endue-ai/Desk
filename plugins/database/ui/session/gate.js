// Disconnect stops what runs on a connection and what the plugin would start on it by itself (ADR
// 0339): it aborts every run in flight on the connection, kept or short, and marks it disconnected.
// A run the plugin starts on its own (`background`: a panel's period, a run's progress read) is then
// refused with the sentence to show, opening no session; any other run, the person's or an agent's,
// connects it again. Marks live in memory: a new page starts connected. No DOM.

import { failedRun } from "../engines/common.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../engines/common.js").RunResult} RunResult
 * @typedef {import("../engines/pg-script.js").Plan} Plan
 */

/** The sentence a refused run shows. */
export const disconnectedLine = (/** @type {string} */ name) =>
  `${name} is disconnected: Refresh by hand to connect again.`;

export function createGate() {
  /** @type {Set<string>} */
  const off = new Set();
  /** The runs in flight, by connection. @type {Map<string, Set<AbortController>>} */
  const flying = new Map();

  return {
    /** Whether the person disconnected the connection and nothing connected it since. */
    disconnected: (/** @type {string} */ id) => off.has(id),
    /** Mark the connection disconnected and stop every run in flight on it. */
    disconnect(/** @type {string} */ id) {
      off.add(id);
      for (const stop of flying.get(id) ?? []) stop.abort();
    },
    /**
     * Run `plan` on `conn` through `go`, unless it is background work on a disconnected connection.
     * @param {Connection} conn @param {Plan} plan
     * @param {(conn: Connection, plan: Plan) => Promise<RunResult>} go
     * @returns {Promise<RunResult>}
     */
    async run(conn, plan, go) {
      if (plan.background && off.has(conn.id))
        return failedRun(plan.statements, { kind: "client", message: disconnectedLine(conn.name) });
      if (!plan.background) off.delete(conn.id);
      const stop = new AbortController();
      const runs = flying.get(conn.id) ?? new Set();
      runs.add(stop);
      flying.set(conn.id, runs);
      const signal = plan.signal ? AbortSignal.any([plan.signal, stop.signal]) : stop.signal;
      try {
        return await go(conn, { ...plan, signal });
      } finally {
        runs.delete(stop);
        if (runs.size === 0 && flying.get(conn.id) === runs) flying.delete(conn.id);
      }
    },
  };
}
