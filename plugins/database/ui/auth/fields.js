// A PostgreSQL connection's sign-in fields of PG-14 (ADR 0354), checked before it is kept: the
// password command (command.js), kept only when set, and "through a pooler" (pooler.js), kept only
// when on, so a connection that never chose either reads as before. A command gives every session
// its password, so the keychain keeps none for that connection. No DOM.

import { commandOf } from "./command.js";
import { checkPooled } from "./pooler.js";

/** @typedef {import("../engines/common.js").Connection} Connection */

/** The fields, as `SIGN_IN` lists them: a change to either closes the connection's sessions. */
export const AUTH = /** @type {const} */ (["passwordCommand", "pooler"]);

/**
 * The fields a connection keeps, checked against the others it holds.
 * @param {Record<string, unknown>} raw
 * @param {Connection} conn the connection's other fields, checked
 * @returns {{ passwordCommand?: string, pooler?: true }}
 */
export function authOf(raw, conn) {
  if (conn.engine !== "postgresql") return {};
  /** @type {{ passwordCommand?: string, pooler?: true }} */
  const out = {};
  const command = commandOf(raw.passwordCommand);
  if (command) {
    if (/** @type {{ keychain?: boolean }} */ (conn).keychain === true)
      throw new Error(
        "Keychain: a connection with a password command gets its password from it; turn one off.",
      );
    out.passwordCommand = command;
  }
  if (raw.pooler === true) out.pooler = true;
  checkPooled(/** @type {Connection} */ ({ ...conn, ...out }));
  return out;
}

/** The connection's password command, "" when it has none. */
export const commandFor = (/** @type {Connection} */ conn) =>
  conn.engine === "postgresql" ? (conn.passwordCommand ?? "") : "";
