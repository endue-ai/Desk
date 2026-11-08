// The explorer's tree (DB-06, DB-19): connections, schemas, then a folder per kind of object
// (tables, views, materialized views, sequences, routines, events) and, under a table, its columns
// and a folder per kind of part (keys, foreign keys, indexes, triggers). A folder reads its children
// from the catalog the first time it opens, says "Loading" meanwhile and the client's words when it
// fails; a refresh forgets what was read under a node. A filter keeps the objects whose name holds
// it; exact row counts, once counted, replace the server's estimate. The tree is a flat list of rows
// for the view, each with its depth, so the view only draws it. No DOM.

import { formatCount } from "./format.js";
import { OBJECT_FOLDERS, PART_FOLDERS, RELATIONS } from "./schema/common.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {ReturnType<typeof import("./catalog.js").createCatalog>} Catalog
 * @typedef {import("./schema/common.js").SchemaObject} SchemaObject
 * @typedef {import("./schema/common.js").Part} Part
 * @typedef {"group" | "connection" | "schema" | "folder" | "table" | "object" | "part" | "column" | "info"} NodeKind
 * @typedef {{
 *   key: string, kind: NodeKind, label: string, detail: string, level: number,
 *   expandable: boolean, expanded: boolean, connection: string, schema?: string, table?: string,
 *   object?: SchemaObject, part?: Part, tag?: string, color?: string, error?: boolean, scope?: string,
 * }} Node
 *   `table` names the relation a table, column or part row belongs to; `object` and `part` say
 *   what a row's DDL is of; `scope` is the row (schema or table) a refresh here reads again.
 * @typedef {{ status: "loading" | "ready" | "error", items: unknown[], message?: string }} Load
 */

const ENGINE_LABELS = { postgresql: "PostgreSQL", mysql: "MySQL", sqlite: "SQLite" };
const SEP = "\u0000";

/**
 * @param {Catalog} catalog
 * @param {() => Connection[]} connections
 * @param {() => void} changed Called when rows change (a folder loaded or failed).
 */
export function createExplorer(catalog, connections, changed) {
  /** @type {Set<string>} */
  const expanded = new Set();
  /** Groups of connections are open until closed. @type {Set<string>} */
  const closedGroups = new Set();
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

  const matches = (/** @type {string} */ name) =>
    filter === "" || name.toLowerCase().includes(filter.toLowerCase());

  /** The rows on screen, in order. */
  const rows = () => {
    /** @type {Node[]} */
    const out = [];
    /** @param {Omit<Node, "expanded"> & { expanded?: boolean }} node */
    const push = (node) => {
      const open = node.expandable && expanded.has(node.key);
      out.push({ ...node, expanded: open });
      return open;
    };
    /** The line standing for children not there: loading, failed or empty. */
    const info = (
      /** @type {string} */ key,
      /** @type {Load} */ state,
      level,
      connection,
      empty = "Empty",
    ) =>
      out.push({
        key: `${key}${SEP}info`,
        kind: "info",
        label:
          state.status === "loading"
            ? "Loading…"
            : state.status === "error"
              ? (state.message ?? "Failed")
              : empty,
        detail: "",
        level,
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

    /** A connection, and when it is open its schemas. */
    function connectionRows(/** @type {Connection} */ conn) {
      const where =
        conn.engine === "sqlite"
          ? conn.file
          : `${conn.host || "localhost"}${conn.port ? `:${conn.port}` : ""}`;
      const open = push({
        key: conn.id,
        kind: "connection",
        label: conn.name,
        detail: `${ENGINE_LABELS[conn.engine]} · ${where}${conn.readOnly ? " · read-only" : ""}`,
        level: 1,
        expandable: true,
        connection: conn.id,
        tag: conn.tag,
        color: conn.color,
      });
      if (!open) return;
      const schemasKey = `${conn.id}${SEP}schemas`;
      const schemas = load(schemasKey, () => catalog.schemas(conn));
      if (schemas.status !== "ready" || schemas.items.length === 0) {
        info(schemasKey, schemas, 2, conn.id);
        return;
      }
      for (const schema of /** @type {string[]} */ (schemas.items)) {
        const schemaKey = `${conn.id}${SEP}s${SEP}${schema}`;
        const schemaOpen = push({
          key: schemaKey,
          kind: "schema",
          label: schema,
          detail: "",
          level: 2,
          expandable: true,
          connection: conn.id,
          schema,
          scope: schemaKey,
        });
        if (schemaOpen) schemaRows(conn, schema, schemaKey);
      }
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
      for (const [label, kinds] of OBJECT_FOLDERS) {
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
      const kind = object.kind === "table" || object.kind === "view" ? "" : object.kind;
      const open = push({
        key,
        kind: relation ? "table" : "object",
        label: object.name,
        detail: [kind, object.detail, rowsText].filter(Boolean).join(" · "),
        level: 4,
        expandable: relation,
        connection: conn.id,
        schema: object.schema,
        ...(relation ? { table: object.name } : {}),
        object,
        scope: relation ? key : schemaKey,
      });
      if (open) tableRows(conn, object, key);
    }

    /** A relation's columns, then its parts by folder. */
    function tableRows(
      /** @type {Connection} */ conn,
      /** @type {SchemaObject} */ object,
      /** @type {string} */ key,
    ) {
      const base = { connection: conn.id, schema: object.schema, table: object.name, scope: key };
      const columnsKey = `${key}${SEP}columns`;
      const columnsOpen = push({
        ...base,
        key: columnsKey,
        kind: "folder",
        label: "Columns",
        detail: "",
        level: 5,
        expandable: true,
      });
      if (columnsOpen) {
        const state = load(columnsKey, () => catalog.columns(conn, object.schema, object.name));
        if (state.status !== "ready" || state.items.length === 0)
          info(columnsKey, state, 6, conn.id);
        else
          for (const column of /** @type {import("./catalog.js").Column[]} */ (state.items)) {
            const flags = [
              column.primary ? "PK" : "",
              column.nullable ? "" : "NOT NULL",
              column.default !== null ? `= ${column.default}` : "",
            ].filter(Boolean);
            push({
              ...base,
              key: `${columnsKey}${SEP}${column.name}`,
              kind: "column",
              label: column.name,
              detail: [column.type, ...flags].join(" "),
              level: 6,
              expandable: false,
            });
          }
      }
      if (!RELATIONS.has(object.kind) || object.kind === "view") return;
      const partsKey = `${key}${SEP}parts`;
      const state = load(partsKey, () => catalog.parts(conn, object.schema, object.name));
      if (state.status !== "ready") {
        info(partsKey, state, 5, conn.id);
        return;
      }
      const parts = /** @type {Part[]} */ (state.items);
      for (const [label, kinds] of PART_FOLDERS) {
        const held = parts.filter((p) => /** @type {readonly string[]} */ (kinds).includes(p.kind));
        if (held.length === 0) continue;
        const folderKey = `${key}${SEP}p${SEP}${label}`;
        const open = push({
          ...base,
          key: folderKey,
          kind: "folder",
          label,
          detail: formatCount(held.length),
          level: 5,
          expandable: true,
        });
        if (!open) continue;
        for (const part of held)
          push({
            ...base,
            key: `${folderKey}${SEP}${part.name}`,
            kind: "part",
            label: part.name,
            detail: part.kind === "index" || part.kind === "foreign key" ? part.detail : part.kind,
            level: 6,
            expandable: false,
            part,
          });
      }
    }
  };

  return {
    rows,
    /** Open or close a folder; `open` forces one way. */
    toggle(/** @type {Node} */ node, /** @type {boolean | undefined} */ open) {
      if (!node.expandable) return;
      if (node.kind === "group") {
        const close = !(open ?? closedGroups.has(node.key));
        if (close) closedGroups.add(node.key);
        else closedGroups.delete(node.key);
        changed();
        return;
      }
      const next = open ?? !expanded.has(node.key);
      if (next) expanded.add(node.key);
      else expanded.delete(node.key);
      changed();
    },
    /** Forget what was read under a node (a connection, a schema, a table), or under every one. */
    refresh(/** @type {string | undefined} */ connection, /** @type {Node | undefined} */ node) {
      const scope = node && node.kind !== "connection" ? node.scope : undefined;
      if (!scope || node?.schema === undefined) catalog.forget(connection);
      else if (node.table) {
        catalog.forget(connection, ["columns", node.schema, node.table]);
        catalog.forget(connection, ["parts", node.schema, node.table]);
      } else
        for (const what of ["objects", "columns", "parts"])
          catalog.forget(connection, [what, node.schema]);
      const prefix = scope ?? connection;
      const under = (/** @type {string} */ key) =>
        prefix === undefined || key === prefix || key.startsWith(`${prefix}${SEP}`);
      for (const key of [...loads.keys()]) if (under(key)) loads.delete(key);
      for (const key of [...counts.keys()]) if (under(key)) counts.delete(key);
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
