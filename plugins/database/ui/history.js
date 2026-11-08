// What ran on each connection, newest first, in the plugin's store: the statement, when, how long,
// and how it ended (rows, or the error's first words). Results are never kept, nor statements that
// look like they carry a password (CREATE USER ... PASSWORD, IDENTIFIED BY). Starred queries are
// kept apart, by name, per connection, until they are unstarred or the connection is removed.

/**
 * @typedef {{ at: string, sql: string, ms: number, ok: boolean, summary: string }} Entry
 * @typedef {{ name: string, sql: string, at: string }} Saved
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 */

const LIMIT = 60 * 1024;
const SQL_MAX = 4096;
const SECRET = /\b(?:PASSWORD|IDENTIFIED\s+(?:BY|WITH)|ENCRYPTED|SECRET|TOKEN)\b/iu;

const keyOf = (/** @type {string} */ connection) => `history:${connection}`;
const savedKey = (/** @type {string} */ connection) => `saved:${connection}`;

/** Whether a statement may be kept. */
export function keepable(/** @type {string} */ sql) {
  return !SECRET.test(sql);
}

/**
 * @param {Bridge} bridge
 * @param {string} connection
 * @returns {Promise<Entry[]>}
 */
export async function readHistory(bridge, connection) {
  const kept = await bridge.call("store.get", { key: keyOf(connection) }).catch(() => ({}));
  return Array.isArray(kept.value) ? /** @type {Entry[]} */ (kept.value) : [];
}

/**
 * Add entries (oldest first) in front of the kept ones, at most `max`, within the store's size.
 * @param {Bridge} bridge
 * @param {string} connection
 * @param {Entry[]} entries
 * @param {number} max
 */
export async function addHistory(bridge, connection, entries, max) {
  const fresh = entries
    .filter((entry) => keepable(entry.sql))
    .map((entry) => ({ ...entry, sql: entry.sql.slice(0, SQL_MAX) }))
    .reverse();
  if (fresh.length === 0 || max === 0) return;
  let list = [...fresh, ...(await readHistory(bridge, connection))].slice(0, max);
  while (list.length > 1 && JSON.stringify(list).length > LIMIT) list = list.slice(0, -1);
  await bridge.call("store.set", { key: keyOf(connection), value: list }).catch(() => {});
}

/** Forget a connection's history and starred queries, when the connection is removed. */
export async function clearHistory(/** @type {Bridge} */ bridge, /** @type {string} */ connection) {
  await bridge.call("store.set", { key: keyOf(connection), value: [] }).catch(() => {});
  await bridge.call("store.set", { key: savedKey(connection), value: [] }).catch(() => {});
}

/** A connection's starred queries, by name. @returns {Promise<Saved[]>} */
export async function readSaved(/** @type {Bridge} */ bridge, /** @type {string} */ connection) {
  const kept = await bridge.call("store.get", { key: savedKey(connection) }).catch(() => ({}));
  return Array.isArray(kept.value) ? /** @type {Saved[]} */ (kept.value) : [];
}

/**
 * Star a query under a name (one of the same name is replaced). It must fit the store with the
 * others, and carry no password.
 * @param {Bridge} bridge
 * @param {string} connection
 * @param {{ name: string, sql: string, at?: string }} query
 */
export async function saveQuery(bridge, connection, query) {
  const name = query.name.trim().slice(0, 80);
  if (!name) throw new Error("A starred query needs a name.");
  if (!keepable(query.sql))
    throw new Error("This query looks like it holds a password: it is not kept.");
  if (query.sql.length > SQL_MAX * 4)
    throw new Error("This query is too long to keep (16 KB at most).");
  const others = (await readSaved(bridge, connection)).filter((s) => s.name !== name);
  const list = [{ name, sql: query.sql, at: query.at ?? new Date().toISOString() }, ...others].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  if (JSON.stringify(list).length > LIMIT)
    throw new Error("Too many starred queries: unstar some first.");
  await bridge.call("store.set", { key: savedKey(connection), value: list });
  return name;
}

/** Unstar a query by name. */
export async function removeSaved(
  /** @type {Bridge} */ bridge,
  /** @type {string} */ connection,
  /** @type {string} */ name,
) {
  const list = (await readSaved(bridge, connection)).filter((s) => s.name !== name);
  await bridge.call("store.set", { key: savedKey(connection), value: list });
}
