import { t } from "./strings/index.js";
// Passwords the desk keeps in the OS keychain (ADR 0311): which connections have one, keeping a
// password the person typed or a URI gave, and forgetting it. The plugin hands a password in once
// (db.passwords.set) and never gets it back; a session names it instead. PostgreSQL only, the one
// engine the core opens sessions for (ADR 0281). No DOM.
//
// The hook for the session (PG-01c): db.open takes `password` when the session holds one in memory,
// else `passwordRef: ref(conn)`, and its host, port and user must be `endpoint(conn)`'s for the kept
// password to apply. The core reads the password file first, as before.

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 * @typedef {{ host: string, port: number, user: string }} Endpoint
 */

/** Whether a connection may keep its password in the keychain. */
export const offered = (/** @type {Connection} */ conn) => conn.engine === "postgresql";

/** Whether the person chose to keep the connection's password in the keychain. */
export const chosen = (/** @type {Connection} */ conn) =>
  /** @type {{ keychain?: boolean }} */ (conn).keychain === true;

/** The connection with the choice on or off; off leaves no field behind. */
export function withChoice(/** @type {Connection} */ conn, /** @type {boolean} */ on) {
  const copy = /** @type {Connection & { keychain?: boolean }} */ ({ ...conn });
  if (on) copy.keychain = true;
  else delete copy.keychain;
  return /** @type {Connection} */ (copy);
}

/** The host, port and user a kept password is for, as db.open names them. */
export function endpoint(/** @type {Connection} */ conn) {
  return { host: conn.host || "localhost", port: conn.port ?? 5432, user: conn.user };
}

const same = (/** @type {Endpoint} */ a, /** @type {Endpoint} */ b) =>
  a.host === b.host && a.port === b.port && a.user === b.user;

/**
 * @param {Bridge} bridge
 * @param {() => void} changed Called when what is kept changes, so the list draws again.
 */
export function createKeychain(bridge, changed) {
  /** What the core says is kept, by connection id. @type {Map<string, Endpoint>} */
  let kept = new Map();
  /** Whether the keychain keeps a password for the connection as it is now. */
  const has = (/** @type {Connection} */ conn) => {
    const at = kept.get(conn.id);
    return at !== undefined && offered(conn) && same(at, endpoint(conn));
  };

  return {
    /** Read what is kept; a desk without the call keeps nothing. */
    async load() {
      const answer = await bridge.call("db.passwords.list", {}).catch(() => ({ passwords: [] }));
      kept = new Map(
        (answer?.passwords ?? []).map((p) => [
          p.name,
          { host: p.host, port: p.port, user: p.user },
        ]),
      );
      changed();
    },
    has,
    /** Whether the keychain keeps one under the connection's id, whatever server it was for. */
    holds: (/** @type {string} */ id) => kept.has(id),
    /** The name db.open takes as passwordRef, when the keychain keeps the connection's password. */
    ref: (/** @type {Connection} */ conn) => (has(conn) ? conn.id : undefined),
    /** Keep `password` for the connection; throws with the core's words when it cannot. */
    async keep(/** @type {Connection} */ conn, /** @type {string} */ password) {
      if (!offered(conn)) throw new Error(t("keychain.onlyAPostgresqlConnectionSPassword"));
      const at = endpoint(conn);
      if (!at.user) throw new Error(t("keychain.nameTheConnectionSUserTo"));
      await bridge.call("db.passwords.set", { name: conn.id, ...at, password });
      kept.set(conn.id, at);
      changed();
    },
    /** Forget the connection's kept password, if there is one. */
    async forget(/** @type {string} */ id) {
      if (!kept.has(id)) return false;
      await bridge.call("db.passwords.delete", { name: id });
      kept.delete(id);
      changed();
      return true;
    },
  };
}
