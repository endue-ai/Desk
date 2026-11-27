// The explorer's rows of an open PostgreSQL connection (PG-13, ADR 0321): the databases of its
// server it may connect to, its own first and open until closed, then the others by name. Each
// opens to what it holds (its schemas, its Database and Server rows), read under its own reference
// (databases.js) only once it opens. The list comes with the own database's schema cache, so it
// costs no statement; until it is there, or when it cannot be read, the own database stands
// alone. A database whose schemas could not be read is a failed row with the reason under it, and
// nothing else changes. No DOM.

import { baseOf, databaseOf, onDatabase, ownDatabase } from "./databases.js";
import { labelsOf } from "./schema-cache/view.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./explorer.js").Node} Node
 * @typedef {import("./explorer.js").Load} Load
 * @typedef {{
 *   conn: Connection,
 *   catalog: Pick<import("./explorer.js").Catalog, "databases" | "status">,
 *   load(key: string, read: () => Promise<unknown[]>): Load,
 *   peek(key: string): Load | undefined,
 *   push(node: Omit<Node, "expanded"> & { expanded?: boolean }): boolean,
 *   shut: Set<string>,
 *   inside(conn: Connection, prefix: string): void,
 * }} At
 *   `peek` is a load without starting it; `shut` holds the own databases' rows the person closed;
 *   `inside` draws a database's rows one level down, its keys under `prefix`.
 */

const SEP = "\u0000";

/** The key of a database's row, under its connection's: the prefix of every row it holds. */
export const databaseKey = (/** @type {string} */ connection, /** @type {string} */ database) =>
  `${connection}${SEP}d${SEP}${database}`;

/** The rows' prefix of what a reference's cache holds: its database's row, or its connection's. */
export function prefixOf(/** @type {string} */ ref) {
  const database = databaseOf(ref);
  return database === undefined ? ref : databaseKey(baseOf(ref), database);
}

/** The databases of an open PostgreSQL connection, each with what it holds when open. */
export function databaseRows(/** @type {At} */ at) {
  const { conn } = at;
  const own = ownDatabase(conn);
  const list = at.load(`${conn.id}${SEP}databases`, () => at.catalog.databases(conn));
  const listed = /** @type {{ name: string, template: boolean }[]} */ (
    list.status === "ready" ? list.items : []
  );
  const others = listed.filter((d) => d.name !== own);
  for (const { name, template } of [{ name: own, template: false }, ...others]) {
    const db = onDatabase(conn, name);
    const key = databaseKey(conn.id, name);
    const home = name === own;
    const failed = at.peek(`${key}${SEP}schemas`)?.status === "error";
    const read = home ? "" : labelsOf(at.catalog.status?.(db))?.detail;
    const open = at.push({
      key,
      kind: "database",
      label: name,
      detail: [home ? "the connection's" : "", template ? "template" : "", read]
        .filter(Boolean)
        .join(" · "),
      level: 2,
      expandable: true,
      connection: db.id,
      database: name,
      scope: key,
      ...(home ? { home: true, expanded: !at.shut.has(key) } : {}),
      ...(failed ? { error: true } : {}),
    });
    if (open) at.inside(db, key);
  }
}
