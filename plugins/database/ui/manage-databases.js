// The connection manager over every database of a server (PG-13, ADR 0321): `get` and `choose` also
// answer a reference to another database (`<id>/<database>`, databases.js), and what is the
// connection's, whichever of its databases a command names, goes to the connection itself: its
// password and keychain choice (one for the whole server), and editing, duplicating, removing,
// disconnecting and forgetting its password. The manager (manage.js) knows only connections. No DOM.

import { baseOf, databaseOf, homeOf, onDatabase } from "./databases.js";
import { createManager } from "./manage.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {ReturnType<typeof import("./manage.js").createManager>} Manager
 */

/** @param {Manager} manager @returns {Manager} */
export function onDatabases(manager) {
  const { passwords } = manager;
  /** A connection by id or name, or on another database by its reference. */
  const get = (/** @type {string} */ ref) => {
    const found = manager.get(ref);
    const database = databaseOf(ref);
    if (found || database === undefined) return found;
    const conn = manager.get(baseOf(ref));
    return conn ? onDatabase(conn, database) : undefined;
  };
  /** The connection's own id for a reference to any of its databases. */
  const home = (/** @type {string | undefined} */ ref) => {
    const conn = ref ? get(ref) : undefined;
    return conn ? homeOf(conn).id : ref;
  };
  /** @param {(ref: string | undefined) => Promise<unknown>} act */
  const atHome = (act) => (/** @type {string | undefined} */ ref) => act(home(ref));
  return {
    ...manager,
    get,
    choose: async (ref, title) => (ref ? get(ref) : undefined) ?? manager.choose(ref, title),
    passwords: {
      ...passwords,
      get: (id) => passwords.get(baseOf(id)),
      set: (id, value) => passwords.set(baseOf(id), value),
      ref: (conn) => passwords.ref(homeOf(conn)),
      // The prompt names the database; the answer and its keychain choice are the connection's.
      ask: (conn, why) => passwords.ask({ ...conn, id: homeOf(conn).id }, why),
    },
    edit: atHome(manager.edit),
    duplicate: atHome(manager.duplicate),
    remove: atHome(manager.remove),
    disconnect: atHome(manager.disconnect),
    forgetPassword: atHome(manager.forgetPassword),
  };
}

/** The manager (manage.js) made from its deps, over every database of a server. */
export const createDatabasesManager = (/** @type {Parameters<typeof createManager>[0]} */ deps) =>
  onDatabases(createManager(deps));
