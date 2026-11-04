// What the plugin keeps between runs, in its own `store.*` namespace: one conversation per agent,
// the board and the person's choices. The desk keeps 64 KiB of JSON per key, so each value is cut
// to fit before it is written: the oldest entries go first, then long texts are shortened.

/** The most a value may take, a little under the desk's 64 KiB. */
export const VALUE_LIMIT = 60 * 1024;

/** The size of a value as the desk counts it: bytes of UTF-8 JSON. */
export function sizeOf(/** @type {unknown} */ value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Shorten a text to `max` characters, saying so at the end.
 * @param {string} text
 * @param {number} max
 */
export function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}\n\n[… cut to keep]` : text;
}

/**
 * A list cut to fit `limit` once wrapped by `wrap`: the first items (the oldest) are dropped first.
 * @template T
 * @param {T[]} items
 * @param {(items: T[]) => unknown} wrap
 * @param {number} [limit]
 * @returns {T[]}
 */
export function fitList(items, wrap, limit = VALUE_LIMIT) {
  let kept = items;
  while (kept.length > 0 && sizeOf(wrap(kept)) > limit) kept = kept.slice(1);
  return kept;
}

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @param {string} key
 * @returns {Promise<unknown>}
 */
export async function load(bridge, key) {
  const kept = await bridge.call("store.get", { key }).catch(() => ({}));
  return /** @type {{ value?: unknown }} */ (kept).value;
}

/**
 * Write a value; a desk that refuses keeps the last one.
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @param {string} key
 * @param {unknown} value
 */
export async function save(bridge, key, value) {
  await bridge.call("store.set", { key, value }).catch(() => {});
}
