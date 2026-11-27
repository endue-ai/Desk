// One PostgreSQL connection, every database of its server (PG-13, ADR 0321). A connection opens on
// the database it names; the same connection on another database of its server is that connection
// with `database` replaced, under a reference of its own, `<id>/<database>` (a connection's id
// never holds a slash), and called `<name>/<database>` on screen. What is kept per connection (its
// password, history and starred queries) is kept under the id before the slash; what is read of a
// database (its explorer rows, its schema cache) under the whole reference. Pure.

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {Connection & { home?: Connection }} OnDatabase
 *   `home` is the connection itself, on another database than its own.
 */

const SLASH = "/";

/** The database a PostgreSQL connection opens on: the one it names, else its user's (libpq's). */
export const ownDatabase = (/** @type {Connection} */ conn) => conn.database || conn.user;

/** The connection's id a reference starts with: all of it, or what is before its slash. */
export function baseOf(/** @type {string} */ ref) {
  const at = ref.indexOf(SLASH);
  return at < 0 ? ref : ref.slice(0, at);
}

/** The database a reference names after its slash, or undefined for a connection's own. */
export function databaseOf(/** @type {string} */ ref) {
  const at = ref.indexOf(SLASH);
  return at < 0 ? undefined : ref.slice(at + 1);
}

/** The connection itself, of a connection on another database. */
export const homeOf = (/** @type {OnDatabase} */ conn) => conn.home ?? conn;

/**
 * The connection on a database of its server: itself on its own (or none named), else a copy with
 * that database, its reference and its name.
 * @param {OnDatabase} conn
 * @param {string | undefined} database
 * @returns {OnDatabase}
 */
export function onDatabase(conn, database) {
  const home = homeOf(conn);
  if (!database || database === ownDatabase(home)) return home;
  return {
    ...home,
    id: `${home.id}${SLASH}${database}`,
    name: `${home.name}${SLASH}${database}`,
    database,
    home,
  };
}

/**
 * The databases a server's own cache lists (schema/pg/server.js), by name; a template only when
 * system objects are shown.
 * @param {import("./schema/common.js").SchemaObject[]} objects The database level's objects.
 * @param {boolean} templates
 */
export const listedDatabases = (objects, templates) =>
  objects
    .filter((o) => o.kind === "database" && (templates || o.detail !== "template"))
    .map((o) => ({ name: o.name, template: o.detail === "template" }));

/** A short, steady name of a text for a store key (FNV-1a, 32 bits, in base 36). */
export function hashOf(/** @type {string} */ text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * What a reference is called in the plugin's store keys ([a-z0-9._-]): the connection's id, and for
 * another database `.d-` and its name's hash (the cache checks the database it was read from).
 */
export function storeIdOf(/** @type {string} */ ref) {
  const database = databaseOf(ref);
  return database === undefined ? ref : `${baseOf(ref)}.d-${hashOf(database)}`;
}
