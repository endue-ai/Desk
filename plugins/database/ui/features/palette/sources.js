// Where the palette's database names come from (PG-80): every PostgreSQL connection the person has
// not hidden, on its own database and on each other database of its server whose cache was kept
// (PG-13). A cache read this session answers from memory; one that was not is read from the plugin's
// store once, the way the cache restores it, and kept for the session. Nothing asks a server. No DOM.

import { baseOf, listedDatabases, onDatabase, storeIdOf } from "../../databases.js";
import { whereOf } from "../../schema-cache/index.js";
import { DATABASE, POSTGRES_KINDS, signature } from "../../schema-cache/kinds.js";
import { databasesKey, restore } from "../../schema-cache/store.js";
import { viewOf } from "../../schema-cache/view.js";
import { namesOf } from "./names.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../schema-cache/view.js").CacheView} CacheView
 * @typedef {import("../../schema-cache/store.js").Store} Store
 * @typedef {import("./names.js").Name} Name
 * @typedef {{ conn: Connection, blocks: Name[][] }} Source
 *   `conn` is the connection on one database: its `id` the reference (`<id>/<database>`), its
 *   `name` what the row says (`Shop/analytics`).
 */

/** The key of the plugin's store that lists the connections hidden from the palette. */
export const HIDDEN_KEY = "palette.hidden";

/** The ids a stored value lists. */
export const idsOf = (/** @type {unknown} */ value) =>
  Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];

/**
 * @param {{
 *   connections(): Connection[],
 *   view(conn: Connection): CacheView | undefined,
 *   store: Store,
 * }} deps `view` is the schema cache's answer from memory (catalog.cache.view).
 */
export function createSources(deps) {
  /** Caches read from the store, by store id and server. @type {Map<string, Promise<CacheView | undefined>>} */
  const stored = new Map();
  /** The store ids of each connection's other databases. @type {Map<string, Promise<string[]>>} */
  const others = new Map();
  /** @type {Promise<Set<string>> | undefined} */
  let hidden;
  const kinds = signature(POSTGRES_KINDS);

  const fromStore = (/** @type {Connection} */ conn) => {
    const key = `${storeIdOf(conn.id)}\u0000${whereOf(conn)}`;
    let found = stored.get(key);
    if (!found) {
      found = restore(deps.store, storeIdOf(conn.id), { where: whereOf(conn), kinds }).then(
        (kept) =>
          kept &&
          viewOf(
            {
              schemas: new Map(kept.schemas.map((s) => [s.name, s])),
              all: kept.all,
              chosen: kept.chosen,
              over: new Set(),
              readAt: kept.readAt,
              status: { state: "idle" },
              note: "",
            },
            false,
          ),
        () => undefined,
      );
      stored.set(key, found);
    }
    return found;
  };
  /** What the cache holds of a connection on a database: memory first, else the store. */
  const viewFor = async (/** @type {Connection} */ conn) => {
    const memory = deps.view(conn);
    if (memory && (memory.schemas().length > 0 || memory.objects(DATABASE))) return memory;
    return (await fromStore(conn)) ?? memory;
  };
  const othersOf = (/** @type {string} */ id) => {
    let found = others.get(id);
    if (!found) {
      found = deps.store.get(databasesKey(id)).then(idsOf, () => []);
      others.set(id, found);
    }
    return found;
  };

  return {
    /** The ids of the connections hidden from the palette. */
    hidden() {
      hidden ??= deps.store.get(HIDDEN_KEY).then(
        (v) => new Set(idsOf(v)),
        () => new Set(),
      );
      return hidden;
    },
    /** Hide a connection from the palette, or show it again; answers whether it is hidden now. */
    async toggle(/** @type {string} */ id) {
      const now = new Set(await this.hidden());
      const hide = !now.has(id);
      if (hide) now.add(id);
      else now.delete(id);
      await deps.store.set(HIDDEN_KEY, [...now].sort());
      hidden = Promise.resolve(now);
      return hide;
    },
    /**
     * The cache of every PostgreSQL connection on its own database and each other database of its
     * server that has one, in the connections' order; with `skipHidden`, not those hidden here.
     * The source search (PG-82) reads the same caches.
     */
    async views(skipHidden = false) {
      const skip = skipHidden ? await this.hidden() : new Set();
      const conns = deps
        .connections()
        .filter((c) => c.engine === "postgresql" && !skip.has(baseOf(c.id)));
      const lists = await Promise.all(
        conns.map(async (conn) => {
          const own = await viewFor(conn);
          const listed = own ? listedDatabases(own.objects(DATABASE) ?? [], true) : [];
          const kept = new Set(await othersOf(conn.id));
          const more = listed
            .map((db) => onDatabase(conn, db.name))
            .filter((db) => db !== conn && (kept.has(storeIdOf(db.id)) || deps.view(db)));
          const views = await Promise.all(more.map(viewFor));
          /** @type {{ conn: Connection, view: CacheView }[]} */
          const found = own ? [{ conn, view: own }] : [];
          more.forEach((db, i) => {
            const view = views[i];
            if (view) found.push({ conn: db, view });
          });
          return found;
        }),
      );
      return lists.flat();
    },
    /** What the cache holds of a connection on a database: memory first, else the store. */
    viewFor,
    /** Every source the palette searches, in the connections' order, each one's own database first. */
    async all() {
      /** @type {Source[]} */
      const sources = (await this.views(true)).map(({ conn, view }) => ({
        conn,
        blocks: namesOf(view),
      }));
      return sources;
    },
  };
}
