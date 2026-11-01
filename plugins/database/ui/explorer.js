// The explorer's tree: connections, then schemas, tables and views, then columns. A folder reads
// its children from the catalog the first time it opens, says "Loading" meanwhile and the client's
// words when it fails; a refresh forgets what was read. The tree is a flat list of rows for the
// view, each with its depth, so the view only draws it. No DOM.

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {ReturnType<typeof import("./catalog.js").createCatalog>} Catalog
 * @typedef {"connection" | "schema" | "table" | "column" | "info"} NodeKind
 * @typedef {{
 *   key: string, kind: NodeKind, label: string, detail: string, level: number,
 *   expandable: boolean, expanded: boolean, connection: string, schema?: string, table?: string,
 *   tag?: string, error?: boolean,
 * }} Node
 * @typedef {{ status: "loading" | "ready" | "error", items: unknown[], message?: string }} Load
 */

const ENGINE_LABELS = { postgresql: "PostgreSQL", mysql: "MySQL", sqlite: "SQLite" };

/**
 * @param {Catalog} catalog
 * @param {() => Connection[]} connections
 * @param {() => void} changed Called when rows change (a folder loaded or failed).
 */
export function createExplorer(catalog, connections, changed) {
  /** @type {Set<string>} */
  const expanded = new Set();
  /** @type {Map<string, Load>} */
  const loads = new Map();

  /**
   * Read a folder's children once; the rows say how it went.
   * @param {string} key
   * @param {() => Promise<unknown[]>} read
   */
  const load = (key, read) => {
    if (loads.has(key)) return;
    loads.set(key, { status: "loading", items: [] });
    read().then(
      (items) => {
        loads.set(key, { status: "ready", items });
        changed();
      },
      (error) => {
        loads.set(key, {
          status: "error",
          items: [],
          message: error instanceof Error ? error.message : String(error),
        });
        changed();
      },
    );
  };

  /** The rows on screen, in order. */
  const rows = () => {
    /** @type {Node[]} */
    const out = [];
    /**
     * Add a folder's children, or the line that stands for them.
     * @param {string} key
     * @param {number} level
     * @param {string} connection
     * @param {() => Promise<unknown[]>} read
     * @param {(item: any) => void} each
     */
    const children = (key, level, connection, read, each) => {
      load(key, read);
      const state = /** @type {Load} */ (loads.get(key));
      if (state.status === "ready" && state.items.length) state.items.forEach(each);
      else {
        const label =
          state.status === "loading"
            ? "Loading…"
            : state.status === "error"
              ? (state.message ?? "Failed")
              : "Empty";
        out.push({
          key: `${key}\u0000info`,
          kind: "info",
          label,
          detail: "",
          level,
          expandable: false,
          expanded: false,
          connection,
          error: state.status === "error",
        });
      }
    };
    for (const conn of connections()) {
      const key = conn.id;
      const open = expanded.has(key);
      const where =
        conn.engine === "sqlite"
          ? conn.file
          : `${conn.host || "localhost"}${conn.port ? `:${conn.port}` : ""}`;
      out.push({
        key,
        kind: "connection",
        label: conn.name,
        detail: `${ENGINE_LABELS[conn.engine]} · ${where}${conn.readOnly ? " · read-only" : ""}`,
        level: 1,
        expandable: true,
        expanded: open,
        connection: conn.id,
        tag: conn.tag,
      });
      if (!open) continue;
      children(
        `${key}\u0000schemas`,
        2,
        conn.id,
        () => catalog.schemas(conn),
        (schema) => {
          const schemaKey = `${key}\u0000s\u0000${schema}`;
          const schemaOpen = expanded.has(schemaKey);
          out.push({
            key: schemaKey,
            kind: "schema",
            label: schema,
            detail: "",
            level: 2,
            expandable: true,
            expanded: schemaOpen,
            connection: conn.id,
            schema,
          });
          if (!schemaOpen) return;
          children(
            `${schemaKey}\u0000tables`,
            3,
            conn.id,
            () => catalog.tables(conn, schema),
            (table) => {
              const tableKey = `${schemaKey}\u0000t\u0000${table.name}`;
              const tableOpen = expanded.has(tableKey);
              out.push({
                key: tableKey,
                kind: "table",
                label: table.name,
                detail: table.type,
                level: 3,
                expandable: true,
                expanded: tableOpen,
                connection: conn.id,
                schema,
                table: table.name,
              });
              if (!tableOpen) return;
              children(
                `${tableKey}\u0000columns`,
                4,
                conn.id,
                () => catalog.columns(conn, schema, table.name),
                (column) => {
                  const flags = [
                    column.primary ? "PK" : "",
                    column.nullable ? "" : "NOT NULL",
                    column.default !== null ? `= ${column.default}` : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  out.push({
                    key: `${tableKey}\u0000c\u0000${column.name}`,
                    kind: "column",
                    label: column.name,
                    detail: `${column.type}${flags ? ` ${flags}` : ""}`,
                    level: 4,
                    expandable: false,
                    expanded: false,
                    connection: conn.id,
                    schema,
                    table: table.name,
                  });
                },
              );
            },
          );
        },
      );
    }
    return out;
  };

  return {
    rows,
    /** Open or close a folder; `open` forces one way. */
    toggle(/** @type {Node} */ node, /** @type {boolean | undefined} */ open) {
      if (!node.expandable) return;
      const next = open ?? !expanded.has(node.key);
      if (next) expanded.add(node.key);
      else expanded.delete(node.key);
      changed();
    },
    /** Forget what was read for a connection (or every one) and read it again when shown. */
    refresh(/** @type {string | undefined} */ connection) {
      catalog.forget(connection);
      for (const key of [...loads.keys()])
        if (connection === undefined || key === connection || key.startsWith(`${connection}\u0000`))
          loads.delete(key);
      changed();
    },
    /** Which folders are open, to keep across a reload. */
    opened: () => [...expanded],
    restore(/** @type {string[]} */ keys) {
      for (const key of keys) expanded.add(key);
    },
  };
}
