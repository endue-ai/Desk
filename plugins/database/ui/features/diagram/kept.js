// A diagram's record in the plugin's store (ADR 0315): what chose its tables, the tables the person
// added and removed, the columns shown, every table's position and the relations the person drew,
// one record per connection and diagram under `diagram.<hash>`. A record that does not fit one key
// (64 KiB of JSON) is written as text in chunks `diagram.<hash>.<n>` of at most CHUNK bytes, each
// naming the write it belongs to, so a chunk an interrupted write left is never read as the record;
// past CHUNKS it is not kept, and the diagram holds it for the session only. The record names its
// connection and diagram, so a hash shared by two is read as none. Never rows, never secrets.

/**
 * @typedef {import("./model.js").Ref} Ref
 * @typedef {import("./model.js").Choice} Choice
 * @typedef {import("./model.js").Drawn} Drawn
 * @typedef {import("./layout.js").Mode} Mode
 * @typedef {{
 *   choice: Choice, mode: Mode, at: [string, string, number, number][], added: Ref[],
 *   removed: Ref[], drawn: Drawn[],
 * }} Record `at` holds schema, table, x and y.
 * @typedef {{ get(key: string): Promise<unknown>, set(key: string, value: unknown): Promise<void> }} Store
 */

export const VERSION = 1;
export const CHUNK = 60 * 1024;
export const CHUNKS = 8;

/** A short hash of a text (FNV-1a), in base 36: store keys are lowercase and short. */
const hash = (/** @type {string} */ text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};

/** The key of a connection's diagram. */
export const keyOf = (/** @type {string} */ connection, /** @type {string} */ id) =>
  `diagram.${hash(connection)}.${hash(`${connection}\u0000${id}`)}`;

/** The bytes a text takes as a JSON string value. */
const bytesOf = (/** @type {string} */ text) =>
  new TextEncoder().encode(JSON.stringify(text)).length;

/** The store's calls over the bridge. @returns {Store} */
export function bridgeStore(
  /** @type {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} */ bridge,
) {
  return {
    get: async (key) => (await bridge.call("store.get", { key })).value,
    set: async (key, value) => {
      await bridge.call("store.set", { key, value });
    },
  };
}

/** A record as read: only what a record holds, or undefined. @returns {Record | undefined} */
function valid(/** @type {unknown} */ value) {
  const r = /** @type {Partial<Record>} */ (value);
  if (!r || typeof r !== "object" || !r.choice || !Array.isArray(r.choice.schemas))
    return undefined;
  const refs = (/** @type {unknown} */ list) =>
    Array.isArray(list)
      ? /** @type {Ref[]} */ (list.filter((x) => Array.isArray(x) && x.length === 2))
      : [];
  return {
    choice: r.choice,
    mode: r.mode === "keys" || r.mode === "none" ? r.mode : "all",
    at: Array.isArray(r.at)
      ? r.at.filter(
          (a) =>
            Array.isArray(a) && a.length === 4 && Number.isFinite(a[2]) && Number.isFinite(a[3]),
        )
      : [],
    added: refs(r.added),
    removed: refs(r.removed),
    drawn: Array.isArray(r.drawn)
      ? r.drawn.filter((d) => d && Array.isArray(d.from) && Array.isArray(d.to))
      : [],
  };
}

/**
 * The record of a connection's diagram, or undefined when none was kept (or it cannot be read).
 * @param {Store} store
 * @param {string} connection
 * @param {string} id
 */
export async function readKept(store, connection, id) {
  const key = keyOf(connection, id);
  const head = /** @type {any} */ (await store.get(key).catch(() => undefined));
  if (!head || head.v !== VERSION || head.connection !== connection || head.id !== id)
    return undefined;
  if (head.record) return valid(head.record);
  if (!Number.isInteger(head.n) || head.n < 1 || head.n > CHUNKS) return undefined;
  let text = "";
  for (let i = 0; i < head.n; i++) {
    const part = /** @type {any} */ (await store.get(`${key}.${i}`).catch(() => undefined));
    if (!part || part.stamp !== head.stamp || part.i !== i || typeof part.text !== "string")
      return undefined;
    text += part.text;
  }
  try {
    return valid(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/**
 * Write a connection's diagram's record; `kept` is false when it is past the cap (not written).
 * @param {Store} store
 * @param {string} connection
 * @param {string} id
 * @param {Record} record
 * @param {number} [stamp] What names this write in its chunks.
 */
export async function writeKept(store, connection, id, record, stamp = Date.now()) {
  const key = keyOf(connection, id);
  const head = { v: VERSION, connection, id };
  const text = JSON.stringify(record);
  if (bytesOf(text) + 256 <= CHUNK) {
    await store.set(key, { ...head, record });
    return { kept: true, chunks: 0 };
  }
  /** @type {string[]} */
  const parts = [];
  let from = 0;
  while (from < text.length) {
    let to = Math.min(text.length, from + CHUNK / 2);
    while (to < text.length && bytesOf(text.slice(from, to + 4096)) < CHUNK - 512) to += 4096;
    while (bytesOf(text.slice(from, to)) > CHUNK - 512) to -= 1024;
    // Never between the two halves of a surrogate pair.
    const code = text.charCodeAt(to - 1);
    if (to < text.length && code >= 0xd800 && code <= 0xdbff) to -= 1;
    parts.push(text.slice(from, to));
    from = to;
    if (parts.length > CHUNKS) return { kept: false, chunks: parts.length };
  }
  for (const [i, part] of parts.entries()) await store.set(`${key}.${i}`, { stamp, i, text: part });
  await store.set(key, { ...head, stamp, n: parts.length });
  return { kept: true, chunks: parts.length };
}
