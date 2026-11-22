// The order several tables are copied in (PG-63): a table another one references goes first, so
// its rows are there when a foreign key, kept on the target or added after the data, checks them.
// A table referencing itself needs nothing; a cycle keeps the order the tables were given. No DOM.

/** @typedef {{ key: string, needs: string[] }} Ordered */

/**
 * The keys of `tables`, each once, parents before the tables that reference them.
 * @param {Ordered[]} tables
 * @returns {string[]}
 */
export function foreignKeyOrder(tables) {
  const keys = new Set(tables.map((t) => t.key));
  /** What each table still waits for, among the tables given. @type {Map<string, Set<string>>} */
  const waits = new Map(
    tables.map((t) => [t.key, new Set(t.needs.filter((n) => n !== t.key && keys.has(n)))]),
  );
  /** @type {string[]} */
  const order = [];
  while (waits.size > 0) {
    const ready = [...waits].find(([, needs]) => needs.size === 0)?.[0];
    // A cycle: the first table left goes, and the others stop waiting for it.
    const next = ready ?? /** @type {string} */ (waits.keys().next().value);
    order.push(next);
    waits.delete(next);
    for (const needs of waits.values()) needs.delete(next);
  }
  return order;
}
