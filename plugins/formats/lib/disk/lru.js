// A small cache of the last few things loaded by key (block tables, grain tables, decoded
// clusters), for the virtual-disk containers.

/**
 * `load` behind a cache of the last `limit` keys; a failed load is forgotten.
 * @template K, V
 * @param {number} limit @param {(key: K) => Promise<V>} load
 * @returns {(key: K) => Promise<V>}
 */
export function lru(limit, load) {
  /** @type {Map<K, Promise<V>>} */
  const kept = new Map();
  return (key) => {
    let got = kept.get(key);
    if (got) kept.delete(key);
    else {
      got = load(key);
      got.catch(() => kept.delete(key));
    }
    kept.set(key, got);
    while (kept.size > limit) kept.delete(/** @type {K} */ (kept.keys().next().value));
    return got;
  };
}
