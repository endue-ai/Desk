// The explorer's tree (DB-06, DB-19): connections, schemas, then a folder per kind of object
// (tables, views, materialized views, sequences, routines, events) and, under a table, its columns
// and a folder per kind of part (keys, foreign keys, indexes, triggers). A folder reads its children
// from the catalog the first time it opens, says "Loading" meanwhile and the client's words when it
// fails; a refresh reads again what is under a node. A PostgreSQL connection answers from its
// schema cache (PG-06): its row says when the cache was read, or how far a pass has come, and a
// schema the person did not choose is marked. A filter keeps the objects whose name holds it; exact
// row counts, once counted, replace the server's estimate. PG-50's kinds have folders of their own,
// and a cached connection ends with Database and Server rows (schema/pg/tree.js). A PostgreSQL
// connection holds its server's databases, each of them that (explorer-databases.js, PG-13). The
// tree is a flat list of rows for the view, each with its depth, so the view only draws it. No DOM.

import { databaseRows, prefixOf } from "./explorer-databases.js";
import { tableRows } from "./explorer-table.js";
import { formatCount } from "./format.js";
import { OBJECT_FOLDERS, RELATIONS } from "./schema/common.js";
import { DATABASE, SCHEMA_FOLDERS } from "./schema/pg/index.js";
import { levelRows, objectDetail } from "./schema/pg/tree.js";
import { labelsOf } from "./schema-cache/view.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {ReturnType<typeof import("./catalog.js").createCatalog>} Catalog
 * @typedef {import("./schema/common.js").SchemaObject} SchemaObject
 * @typedef {import("./schema/common.js").Part} Part
 * @typedef {"group" | "connection" | "database" | "schema" | "folder" | "table" | "object" | "part" | "column" | "info"} NodeKind
 * @typedef {{
 *   key: string, kind: NodeKind, label: string, detail: string, level: number,
 *   expandable: boolean, expanded: boolean, connection: string, schema?: string, table?: string,
 *   object?: SchemaObject, part?: Part, tag?: string, color?: string, error?: boolean, scope?: string,
 *   database?: string, home?: boolean,
 * }} Node
 *   `connection` is the reference of the database a row is in (databases.js); `table` names the
 *   relation a table, column or part row belongs to; `object` and `part` say what a row's DDL is
 *   of; `scope` is the row (database, schema or table) a refresh here reads again; `home` marks
 *   the connection's own database's row, open until closed.
 * @typedef {{ status: "loading" | "ready" | "error", items: unknown[], message?: string }} Load
 */

const ENGINE_LABELS = { postgresql: "PostgreSQL", mysql: "MySQL", sqlite: "SQLite" };
const SEP = "\u0000";

/**
 * @param {Catalog} catalog
 * @param {() => Connection[]} connections
 * @param {() => void} changed Called when rows change (a folder loaded or failed).
 * @param {(conn: Connection) => boolean} [kept] Whether the keychain keeps its password (ADR 0311).
 */
export function createExplorer(catalog, connections, changed, kept = () => false) {
  /** @type {Set<string>} */
  const expanded = new Set();
  /** Groups of connections, and their own databases, are open until closed. @type {Set<string>} */
  const closedGroups = new Set();
  /** @type {Set<string>} */
  const shut = new Set();
  /** @type {Map<string, Load>} */
  const loads = new Map();
  /** Exact row counts, by the table row's key. @type {Map<string, number | null>} */
  const counts = new Map();
  let filter = "";

  /** Read a folder's children once; the rows say how it went. */
  const load = (/** @type {string} */ key, /** @type {() => Promise<unknown[]>} */ read) => {
    if (loads.has(key)) return /** @type {Load} */ (loads.get(key));
    /** @type {Load} */
    const state = { status: "loading", items: [] };
    loads.set(key, state);
    read().then(
      (items) => {
        if (loads.get(key) !== state) return;
        loads.set(key, { status: "ready", items });
        changed();
      },
      (error) => {
        if (loads.get(key) !== state) return;
        const message = error instanceof Error ? error.message : String(error);
        loads.set(key, { status: "error", items: [], message });
        changed();
      },
    );
    return state;
  };

  const under = (/** @type {string | undefined} */ prefix, /** @type {string} */ key) =>
    prefix === undefined || key === prefix || key.startsWith(`${prefix}${SEP}`);
  /** Forget the loads under a prefix (a connection, a schema, a table), so they are read again. */
  const drop = (/** @type {string | undefined} */ prefix) => {
    for (const key of [...loads.keys()]) if (under(prefix, key)) loads.delete(key);
  };

  const matches = (/** @type {string} */ name) =>
    filter === "" || name.toLowerCase().includes(filter.toLowerCase());

  /** The rows on screen, in order. */
  const rows = () => {
    /** @type {Node[]} */
    const out = [];
    /** How much deeper the rows drawn now are: a database's under a PostgreSQL connection. */
    let depth = 0;
    /** @param {Omit<Node, "expanded"> & { expanded?: boolean }} node */
    const push = (node) => {
      const open = node.expandable && (node.expanded ?? expanded.has(node.key));
      out.push({ ...node, level: node.level + depth, expanded: open });
      return open;
    };
    /** The line standing for children not there: loading, failed or empty. */
    const info = (
      /** @type {string} */ key,
      /** @type {Load} */ state,
      level,
      connection,
      empty = "Empty",
      loading = "Loading…",
    ) =>
      out.push({
        key: `${key}${SEP}info`,
        kind: "info",
        label:
          state.status === "loading"
            ? loading
            : state.status === "error"
              ? (state.message ?? "Failed")
              : empty,
        detail: "",
        level: level + depth,
        expandable: false,
        expanded: false,
        connection,
        error: state.status === "error",
      });

    // Connections without a group first, then each group under its name, as they were added.
    const groups = [...new Set(connections().map((c) => c.group ?? ""))].sort((a, b) =>
      a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
    );
    for (const group of groups) {
      if (group) {
        const key = `${SEP}group${SEP}${group}`;
        out.push({
          key,
          kind: "group",
          label: group,
          detail: formatCount(connections().filter((c) => (c.group ?? "") === group).length),
          level: 1,
          expandable: true,
          expanded: !closedGroups.has(key),
          connection: "",
        });
        if (closedGroups.has(key)) continue;
      }
      for (const conn of connections().filter((c) => (c.group ?? "") === group))
        connectionRows(conn);
    }
    return out;

    /** A connection, and when it is open what it holds: a PostgreSQL one's databases. */
    function connectionRows(/** @type {Connection} */ conn) {
      const where =
        conn.engine === "sqlite"
          ? conn.file
          : `${conn.host || "localhost"}${conn.port ? `:${conn.port}` : ""}`;
      const cache = labelsOf(catalog.status?.(conn));
      const open = push({
        key: conn.id,
        kind: "connection",
        label: conn.name,
        detail: [ENGINE_LABELS[conn.engine], where, conn.readOnly ? "read-only" : ""]
          .concat(kept(conn) ? "keychain" : "", cache?.detail ?? "")
          .filter(Boolean)
          .join(" · "),
        level: 1,
        expandable: true,
        connection: conn.id,
        tag: conn.tag,
        color: conn.color,
      });
      if (!open) return;
      if (conn.engine !== "postgresql") return contentRows(conn, conn.id);
      const peek = (/** @type {string} */ key) => loads.get(key);
      const inside = (/** @type {Connection} */ db, /** @type {string} */ prefix) => {
        depth++;
        contentRows(db, prefix);
        depth--;
      };
      databaseRows({ conn, catalog, load, peek, push, shut, inside });
    }

    /** What a connection, or a database of a PostgreSQL server, holds, its rows under `prefix`. */
    function contentRows(/** @type {Connection} */ conn, /** @type {string} */ prefix) {
      const cache = labelsOf(catalog.status?.(conn));
      const schemasKey = `${prefix}${SEP}schemas`;
      const schemas = load(schemasKey, () => catalog.schemas(conn));
      if (schemas.status === "ready" && cache?.stale)
        info(
          `${prefix}${SEP}stale`,
          { status: "error", items: [], message: cache.stale },
          2,
          conn.id,
        );
      if (schemas.status !== "ready" || schemas.items.length === 0) {
        info(schemasKey, schemas, 2, conn.id, "Empty", cache?.progress);
        return;
      }
      for (const schema of /** @type {string[]} */ (schemas.items)) {
        const schemaKey = `${prefix}${SEP}s${SEP}${schema}`;
        const schemaOpen = push({
          key: schemaKey,
          kind: "schema",
          label: schema,
          detail: cache?.schema(schema) ?? "",
          level: 2,
          expandable: true,
          connection: conn.id,
          schema,
          scope: schemaKey,
        });
        if (schemaOpen) schemaRows(conn, schema, schemaKey);
      }
      if (!cache) return;
      const levelKey = `${prefix}${SEP}level`;
      const level = load(`${levelKey}${SEP}objects`, () => catalog.objects(conn, DATABASE));
      const objects = /** @type {SchemaObject[]} */ (level.items);
      if (level.status === "ready") levelRows({ conn, key: levelKey, objects, push, filter });
    }

    /** A schema's folders of objects. */
    function schemaRows(
      /** @type {Connection} */ conn,
      /** @type {string} */ schema,
      /** @type {string} */ key,
    ) {
      const state = load(`${key}${SEP}objects`, () => catalog.objects(conn, schema));
      if (state.status !== "ready" || state.items.length === 0) {
        info(`${key}${SEP}objects`, state, 3, conn.id);
        return;
      }
      const objects = /** @type {SchemaObject[]} */ (state.items);
      for (const [label, kinds] of [...OBJECT_FOLDERS, ...SCHEMA_FOLDERS]) {
        const all = objects.filter((o) =>
          /** @type {readonly string[]} */ (kinds).includes(o.kind),
        );
        const shown = all.filter((o) => matches(o.name));
        if (all.length === 0 || (filter && shown.length === 0)) continue;
        const folderKey = `${key}${SEP}f${SEP}${label}`;
        const count = filter ? `${shown.length} of ${all.length}` : formatCount(all.length);
        const open = push({
          key: folderKey,
          kind: "folder",
          label,
          detail: count,
          level: 3,
          expandable: true,
          connection: conn.id,
          schema,
          scope: key,
        });
        if (open) for (const object of shown) objectRow(conn, object, folderKey, key);
      }
    }

    /** A table, view, sequence or routine; a relation opens to its columns and parts. */
    function objectRow(
      /** @type {Connection} */ conn,
      /** @type {SchemaObject} */ object,
      /** @type {string} */ parent,
      /** @type {string} */ schemaKey,
    ) {
      const relation = RELATIONS.has(object.kind);
      const key = `${parent}${SEP}o${SEP}${object.name}`;
      const exact = counts.get(key);
      const rowsText =
        exact !== undefined && exact !== null
          ? `${formatCount(exact)} rows`
          : object.rows !== null
            ? `~${formatCount(object.rows)} rows`
            : "";
      const open = push({
        key,
        kind: relation ? "table" : "object",
        label: object.name,
        detail: objectDetail(object, rowsText),
        level: 4,
        expandable: relation,
        connection: conn.id,
        schema: object.schema,
        ...(relation ? { table: object.name } : {}),
        object,
        scope: relation ? key : schemaKey,
      });
      if (open) tableRows({ catalog, load, push, info }, conn, object, key);
    }
  };

  return {
    rows,
    /** Open or close a folder; `open` forces one way. */
    toggle(/** @type {Node} */ node, /** @type {boolean | undefined} */ open) {
      if (!node.expandable) return;
      if (node.kind === "group" || node.home) {
        const closed = node.home ? shut : closedGroups;
        const close = !(open ?? closed.has(node.key));
        if (close) closed.add(node.key);
        else closed.delete(node.key);
        changed();
        return;
      }
      const next = open ?? !expanded.has(node.key);
      if (next) expanded.add(node.key);
      else expanded.delete(node.key);
      changed();
    },
    /**
     * Read again what is under a node (a connection: all of it, a schema, a table), or under every
     * connection: the catalog reads it, PostgreSQL's cache in a pass.
     */
    refresh(/** @type {string | undefined} */ connection, /** @type {Node | undefined} */ node) {
      const scope = node && node.kind !== "connection" ? node.scope : undefined;
      const schema = scope ? node?.schema : undefined;
      catalog.refresh(connection, schema, schema === undefined ? undefined : node?.table);
      const prefix = scope ?? connection;
      drop(prefix);
      for (const key of [...counts.keys()]) if (under(prefix, key)) counts.delete(key);
      changed();
    },
    /** What a connection or a database holds changed (its cache was read): draw it again. */
    reread(/** @type {string} */ connection) {
      drop(prefixOf(connection));
      changed();
    },
    /** Keep the objects whose name holds `text`; "" shows them all. */
    filter(/** @type {string} */ text) {
      filter = text.trim();
      changed();
    },
    filtering: () => filter,
    /** Exact row counts for table rows, by key. */
    counted(/** @type {[string, number | null][]} */ entries) {
      for (const [key, value] of entries) counts.set(key, value);
      changed();
    },
    /** Which folders are open, to keep across a reload. */
    opened: () => [...expanded],
    restore(/** @type {string[]} */ keys) {
      for (const key of keys) expanded.add(key);
    },
  };
}
