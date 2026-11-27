// A session's sign-in with its connection's password command (PG-14, ADR 0354): the command's
// password for db.open, and when the server refuses that password (SQLSTATE 28P01, or 28000 that a
// token past its time also gives), the command once more and one more try: a short-lived password
// can expire between the two. A second refusal ends the sign-in in words, with the server's message
// and without asking the person to type a password: the command is where it comes from. The
// password goes into the one db.open call and nowhere else. Without a command, a session signs in
// as before (keptPassword): the password typed, else the keychain's by name. No DOM.

import { endpoint } from "../keychain.js";
import { t } from "../strings/index.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../engines/common.js").DbError} DbError
 * @typedef {import("@endue-ai/bridge").DbOpenResult} Opened
 * @typedef {import("./helper.js").Helper} Helper
 */

/**
 * The password db.open takes without a command: the one typed, else the kept one's name when it is
 * for this host, port and user (endpoint(conn), ADR 0311), else none and the core reads the
 * password file.
 * @param {string | undefined} typed
 * @param {string | undefined} name the keychain's name for the connection's password
 * @param {Connection} conn
 * @param {{ host: string, port: number, user: string }} target
 */
export function keptPassword(typed, name, conn, target) {
  if (typed !== undefined) return { password: typed };
  const at = endpoint(conn);
  const fits = at.host === target.host && at.port === target.port && at.user === target.user;
  return name && fits ? { passwordRef: name } : {};
}

/** Codes a server refuses a password with. */
const REFUSED = new Set(["28P01", "28000"]);

/** Whether the server refused the password db.open handed over. */
export const refusedPassword = (/** @type {Opened} */ opened) =>
  !opened.sessionId && REFUSED.has(opened.error?.code ?? "");

/**
 * Sign in with the command's password; the opened session or the server's answer to db.open, else
 * the error the sign-in ends with.
 * @param {Helper} helper
 * @param {(password: string) => Promise<Opened>} attempt one db.open with that password
 * @param {Connection} conn
 * @param {string} where host:port
 * @returns {Promise<{ opened: Opened } | { error: DbError }>}
 */
export async function signInWithCommand(helper, attempt, conn, where) {
  let refused = /** @type {Opened | undefined} */ (undefined);
  for (let tries = 0; tries < 2; tries++) {
    const got = await helper(conn);
    if ("error" in got) return got;
    const opened = await attempt(got.password);
    if (!refusedPassword(opened)) return { opened };
    refused = opened;
  }
  const server = refused?.error;
  return {
    error: {
      kind: "connect",
      ...(server?.code ? { code: server.code } : {}),
      message: t("auth.signIn.refusedThePasswordSPasswordCommand", {
        where: String(where),
        name: String(conn.name),
        value: String(server?.message ?? t("auth.signIn.refused")),
      }),
    },
  };
}
