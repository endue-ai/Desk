// Who raises the db:connect question (PG-01g, ADR 0335): the person's own act, never a read the plugin
// starts by itself. The completions read the catalog as the person types, so they read a PostgreSQL
// server only once the plugin holds a grant for it (`connectHeld`, perm.query, which asks nothing);
// until then they offer the words they have, and the first run, Test or Connect asks. A refused
// session says how to ask again, and Allow connecting asks through perm.request with `again`, which
// the core honours only from the person's press. No DOM.

import { targetOf } from "../engines/pg-session.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../engines/common.js").DbError} DbError
 * @typedef {import("../engines/common.js").RunResult} RunResult
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 * @typedef {Pick<ReturnType<typeof import("../engines/pg-session.js").createSessions>, "run">} Runs
 */

/** The server a PostgreSQL connection reaches, as db:connect names it, or undefined. */
export function whereOf(/** @type {Connection} */ conn) {
  if (conn.engine !== "postgresql") return undefined;
  const target = targetOf(conn);
  return typeof target === "string" ? undefined : `${target.host}:${target.port}`;
}

/** The label of the press that asks again. */
export const allowLabel = (/** @type {string} */ where) => `Allow connecting to ${where}`;

/** What a refusal says: the server, and the press that asks again. */
export const refusedWords = (/** @type {string} */ where) =>
  `Not allowed to connect to ${where}. ${allowLabel(where)} asks again (Database: allow connecting).`;

/**
 * The press beside a refused run's line, for a Messages tab: Allow connecting to its server.
 * @param {Connection} conn
 * @param {DbError} error
 */
export function offerOf(conn, error) {
  const where = error.kind === "refused" ? whereOf(conn) : undefined;
  return where ? { act: { action: "allowConnect", args: [conn.id], label: allowLabel(where) } } : {};
}

/**
 * The sessions, with a refused run in the words that say how to ask again.
 * @template {Runs} T
 * @param {T} pg
 * @returns {T}
 */
export function wordRefusals(pg) {
  return {
    ...pg,
    async run(/** @type {Connection} */ conn, /** @type {any} */ plan) {
      const result = await pg.run(conn, plan);
      const where = result.error?.kind === "refused" ? whereOf(conn) : undefined;
      return where ? { ...result, error: { kind: "refused", message: refusedWords(where) } } : result;
    },
  };
}

/**
 * Whether the plugin holds a db:connect grant for a connection's server now, without asking (a
 * connection another engine runs needs none).
 * @param {Bridge} bridge
 * @param {Connection} conn
 */
export async function connectHeld(bridge, conn) {
  const where = whereOf(conn);
  if (where === undefined) return conn.engine !== "postgresql";
  const permission = { permission: "db:connect", hosts: [where] };
  const held = /** @type {{ grants?: unknown[] }} */ (
    await bridge
      .call(/** @type {never} */ ("perm.query"), /** @type {never} */ ({ permission }))
      .catch(() => ({ grants: [] }))
  );
  return (held.grants ?? []).length > 0;
}

/**
 * Ask again for a connection's server, as the person's press: perm.request with `again`. Resolves
 * whether it is allowed now.
 * @param {Bridge} bridge
 * @param {Connection} conn
 */
export async function allowConnect(bridge, conn) {
  const where = whereOf(conn);
  if (where === undefined) return false;
  const answer = /** @type {{ granted?: boolean }} */ (
    await bridge.call(
      /** @type {never} */ ("perm.request"),
      /** @type {never} */ ({
        permission: { permission: "db:connect", hosts: [where] },
        reason: `To run SQL on ${conn.name}, a PostgreSQL server`,
        again: true,
      }),
    )
  );
  return answer?.granted === true;
}
