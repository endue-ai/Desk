// What the transaction commands share (PG-20): the PostgreSQL console a command acts on, its
// session's model and transaction, and a statement of transaction control run on that session as
// the plugin's own (no question: the statements it ends were asked about when they ran). No DOM.

import { labelOf } from "../../console-list.js";
import { ownerOf } from "../../session/owners.js";

/**
 * @typedef {import("../../consoles.js").Console} Console
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../session/transaction-words.js").TransactionModel} TransactionModel
 * @typedef {{
 *   consoles: Pick<import("../../feature-host.js").Deps["consoles"], "sessions" | "render" | "current" | "find">,
 *   connection(id: string): Connection | undefined,
 *   execute: import("../../catalog.js").Execute,
 * }} Host
 * @typedef {{
 *   target: Console, conn: Connection, owner: string, label: string,
 *   model: TransactionModel | undefined, transaction: "idle" | "open" | "failed",
 * }} Held
 */

/** A console's session as the commands see it, or undefined when it keeps none. */
export function heldOf(/** @type {Host} */ host, /** @type {Console} */ target) {
  const conn = host.connection(target.connection);
  const who = conn ? ownerOf(target, conn) : undefined;
  if (!conn || !who || target.kind !== "console") return undefined;
  const sessions = host.consoles.sessions;
  const [entry] = sessions?.inTransaction((e) => e.owner === who.owner) ?? [];
  return /** @type {Held} */ ({
    target,
    conn,
    owner: who.owner,
    label: labelOf(target, conn),
    model: sessions?.state(who.owner),
    transaction: entry?.transaction ?? "idle",
  });
}

/** The PostgreSQL console a command names (its name or id), else the one on screen. */
export function consoleOf(/** @type {Host} */ host, /** @type {unknown} */ ref) {
  const named = typeof ref === "string" && ref ? host.consoles.find(ref) : undefined;
  if (typeof ref === "string" && ref && !named) throw new Error(`No console is called ${ref}.`);
  const target = named ?? host.consoles.current();
  if (target?.kind !== "console") throw new Error("No console is on screen.");
  const held = heldOf(host, target);
  if (!held)
    throw new Error(
      "Transactions are kept by a PostgreSQL console: this console's connection is not PostgreSQL.",
    );
  return held;
}

/** Refuse while a run goes on in the console: its statement holds the session. */
export function idleNow(/** @type {Held} */ held) {
  if (held.target.running || held.target.filing || held.model?.state === "running")
    throw new Error("A run is going on in this console: cancel it first.");
}

/** Run one statement of transaction control on the console's session; its error is thrown. */
export async function control(
  /** @type {Host} */ host,
  /** @type {Held} */ held,
  /** @type {string} */ sql,
) {
  const session = ownerOf(held.target, held.conn);
  const done = await host.execute(held.conn, sql, {
    ...(session ? { session } : {}),
    catalog: true,
  });
  host.consoles.render();
  const error = done.result.error ?? done.result.statements[0]?.error;
  if (error) throw new Error(`${held.label}: ${sql} failed: ${error.message}`);
}
