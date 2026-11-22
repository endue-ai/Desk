// The cache on disk, in the plugin's own store (store.get and store.set, 64 KiB of JSON a key, ADR
// 0285): an index under `schema-cache.<connection>` and the schemas' rows as compact JSON text in
// at most CHUNKS chunks of CHUNK_BYTES, `schema-cache.<connection>.<n>`. A chunk names its schema,
// when it was read and which part it is, so one left by an interrupted write is never read as the
// schema. Text, not nested JSON: the core writes its store file pretty-printed, where every array
// item would take a line. Whole schemas past the cap are not kept (the default schema first, then
// by name); they are read again after a restart. Another database of a connection's server is kept
// as one more connection, `<id>.d-<hash>` (databases.js), listed under `schema-cache.<id>.databases`.

import { sizeOf } from "./model.js";

/**
 * @typedef {import("./model.js").SchemaData} SchemaData
 * @typedef {{ get(key: string): Promise<unknown>, set(key: string, value: unknown): Promise<void> }} Store
 * @typedef {{
 *   where: string, kinds: string, chosen: string[] | null, all: [string, string][], readAt: number | null,
 *   schemas: SchemaData[], written: (string | null)[],
 * }} Kept
 *   `all` is every schema of the server with "s" for a system one; `schemas` what was read, in the
 *   order kept; `written` each chunk's text as the store holds it.
 */

export const VERSION = 1;
export const CHUNK_BYTES = 60 * 1024;
export const CHUNKS = 16;
const KEY_LIMIT = 64 * 1024;

export const indexKey = (/** @type {string} */ connection) => `schema-cache.${connection}`;
/** The store ids of the other databases a connection's caches were written for (PG-13). */
export const databasesKey = (/** @type {string} */ connection) =>
  `schema-cache.${connection}.databases`;
export const chunkKey = (/** @type {string} */ connection, /** @type {number} */ n) =>
  `schema-cache.${connection}.${n}`;

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

/** UTF-8 bytes of a text, as the core measures a value: a surrogate pair is one 4-byte character. */
export function utf8Bytes(/** @type {string} */ text) {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}
/** What a text takes as a JSON string value in the store. */
export const storedBytes = (/** @type {string} */ text) => utf8Bytes(JSON.stringify(text));

/**
 * A schema as chunks of text, each under CHUNK_BYTES once stored, or undefined when it needs more
 * than `room` chunks (or one row is too long for any).
 * @param {SchemaData} schema
 * @param {number} room
 */
export function chunksOf(schema, room) {
  if (sizeOf(schema.data) > room * CHUNK_BYTES) return undefined;
  /** @type {Record<string, unknown[]>[]} */
  const parts = [];
  /** @type {Record<string, unknown[]>} */
  let part = {};
  let size = 64;
  for (const [kind, rows] of Object.entries(schema.data))
    for (const row of rows) {
      const bytes = storedBytes(JSON.stringify(row)) + kind.length + 8;
      if (bytes > CHUNK_BYTES - 128) return undefined;
      if (size + bytes > CHUNK_BYTES) {
        parts.push(part);
        if (parts.length >= room) return undefined;
        part = {};
        size = 64;
      }
      const list = part[kind] ?? [];
      list.push(row);
      part[kind] = list;
      size += bytes;
    }
  parts.push(part);
  const texts = parts.map((data, i) =>
    JSON.stringify([schema.name, schema.readAt, i, parts.length, data]),
  );
  return texts.every((t) => storedBytes(t) <= KEY_LIMIT) ? texts : undefined;
}

/**
 * What to write: the chunks of the schemas that fit, in order, and the index naming them.
 * @param {Kept} kept
 */
export function layoutOf(kept) {
  /** @type {string[]} */
  const chunks = [];
  /** @type {[string, string, number, number, number][]} */
  const rows = [];
  /** @type {string[]} */
  const over = [];
  for (const schema of kept.schemas) {
    const texts = chunksOf(schema, CHUNKS - chunks.length);
    if (!texts) {
      over.push(schema.name);
      continue;
    }
    rows.push([schema.name, schema.mark, schema.readAt, chunks.length, texts.length]);
    chunks.push(...texts);
  }
  const index = {
    v: VERSION,
    where: kept.where,
    kinds: kept.kinds,
    chosen: kept.chosen,
    all: kept.all,
    readAt: kept.readAt,
    kept: rows,
  };
  const fits = utf8Bytes(JSON.stringify(index)) <= CHUNK_BYTES;
  return { chunks, index: fits ? index : null, over };
}

/**
 * Write what changed since `kept.written`: new chunks, then nulls where chunks are no more, then
 * the index. Answers the schemas not kept and the chunks as now written.
 * @param {Store} store
 * @param {string} connection
 * @param {Kept} kept
 */
export async function persist(store, connection, kept) {
  const { chunks, index, over } = layoutOf(kept);
  const written = [...kept.written];
  const next = index ? chunks : [];
  for (let n = 0; n < Math.max(next.length, written.length); n++) {
    const value = next[n] ?? null;
    if ((written[n] ?? null) === value) continue;
    await store.set(chunkKey(connection, n), value);
    written[n] = value;
  }
  await store.set(indexKey(connection), index);
  while (written.length > 0 && written[written.length - 1] === null) written.pop();
  return { over: index ? over : kept.schemas.map((s) => s.name), written };
}

/**
 * What the store holds for a connection, when it was written for the same server and kinds. A
 * schema whose chunks do not all name it, its read and their count is left out.
 * @param {Store} store
 * @param {string} connection
 * @param {{ where: string, kinds: string }} expect
 * @returns {Promise<Kept | undefined>}
 */
export async function restore(store, connection, expect) {
  const index = /** @type {Record<string, any> | null | undefined} */ (
    await store.get(indexKey(connection)).catch(() => undefined)
  );
  if (!index || typeof index !== "object") return undefined;
  const chosen =
    Array.isArray(index.chosen) && index.chosen.every((s) => typeof s === "string")
      ? /** @type {string[]} */ (index.chosen)
      : null;
  const fresh = index.v === VERSION && index.where === expect.where;
  if (!fresh) return undefined;
  const rows = /** @type {unknown[]} */ (Array.isArray(index.kept) ? index.kept : []);
  const same = index.kinds === expect.kinds;
  const count = rows.reduce((n, row) => Math.max(n, (row?.[3] ?? 0) + (row?.[4] ?? 0)), 0);
  const texts = await Promise.all(
    Array.from({ length: Math.min(CHUNKS, Number(count) || 0) }, (_, n) =>
      store.get(chunkKey(connection, n)).catch(() => null),
    ),
  );
  /** @type {SchemaData[]} */
  const schemas = [];
  for (const row of same ? rows : []) {
    const [name, mark, readAt, first, length] = /** @type {any[]} */ (row);
    const schema = { name, mark, readAt, data: /** @type {Record<string, any[]>} */ ({}) };
    let whole = typeof name === "string" && typeof mark === "string";
    for (let i = 0; whole && i < length; i++) {
      const parsed = parse(texts[first + i]);
      whole =
        !!parsed &&
        parsed[0] === name &&
        parsed[1] === readAt &&
        parsed[2] === i &&
        parsed[3] === length;
      if (whole)
        for (const [kind, kindRows] of Object.entries(parsed?.[4] ?? {})) {
          const list = schema.data[kind] ?? [];
          for (const row of kindRows) list.push(row);
          schema.data[kind] = list;
        }
    }
    if (whole) schemas.push(schema);
  }
  return {
    where: expect.where,
    kinds: expect.kinds,
    chosen,
    all: Array.isArray(index.all) ? index.all : [],
    readAt: typeof index.readAt === "number" ? index.readAt : null,
    schemas,
    written: texts.map((t) => (typeof t === "string" ? t : null)),
  };
}

/** A chunk's text as [schema, readAt, part, parts, rows by kind], or undefined. */
function parse(/** @type {unknown} */ text) {
  if (typeof text !== "string") return undefined;
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) && value.length === 5 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Forget a connection's cache in the store: its chunks, then its index. */
export async function clear(
  /** @type {Store} */ store,
  /** @type {string} */ connection,
  written = CHUNKS,
) {
  for (let n = 0; n < written; n++) await store.set(chunkKey(connection, n), null).catch(() => {});
  await store.set(indexKey(connection), null).catch(() => {});
}
