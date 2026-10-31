// What ran on each connection, newest first, in the plugin's store: the statement, when, how long,
// and how it ended (rows, or the error's first words). Results are never kept, nor statements that
// look like they carry a password (CREATE USER ... PASSWORD, IDENTIFIED BY).

/**
 * @typedef {{ at: string, sql: string, ms: number, ok: boolean, summary: string }} Entry
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 */

const LIMIT = 60 * 1024;
const SQL_MAX = 4096;
const SECRET = /\b(?:PASSWORD|IDENTIFIED\s+(?:BY|WITH)|ENCRYPTED|SECRET|TOKEN)\b/iu;

const keyOf = (/** @type {string} */ connection) => `history:${connection}`;

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

/** Forget a connection's history, when the connection is removed. */
export async function clearHistory(/** @type {Bridge} */ bridge, /** @type {string} */ connection) {
  await bridge.call("store.set", { key: keyOf(connection), value: [] }).catch(() => {});
}
