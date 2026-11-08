// Drag and drop on the Database surface (ADR 0119), without the DOM. Rows of a result drag as three
// things at once: desk/json `db/rows` { connection, engine, schema?, table?, columns, rows } (NULL
// stays null), SQL INSERT statements as desk/text, and TSV as text/plain, so a console, a note, a
// terminal or a sheet each take the one it reads. A table of the explorer drags its qualified name
// as text. Paths and text dropped on the surface go to dropped.js; on an explorer table, a file is
// imported into that table.

import { tableName } from "./catalog.js";
import { RESERVED } from "./editor/words.js";
import { engineOf } from "./engines/index.js";
import { formatRows } from "./results.js";
import { readableName } from "./sql/quote.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginDnd} PluginDnd
 * @typedef {import("@endue-ai/plugin-sdk").DragStart} DragStart
 * @typedef {import("@endue-ai/plugin-sdk").DragOver} DragOver
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./explorer.js").Node} Node
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {{ row: number, col: number, record?: boolean }} Press
 *   Where a drag started: the grid's row and column on screen, and whether it shows a record.
 * @typedef {{ dropTarget?: object, landing?(element: unknown): unknown,
 *   targetOf?(element: unknown): unknown }} DropView
 */

export const ROWS_KIND = "db/rows";
export const ACCEPTS = ["desk/paths", "desk/text", "text/plain"];

/**
 * @param {{
 *   current(): Console | null,
 *   connection(id: string): Connection | undefined,
 *   selection(): { sorted?: (string | null)[][], rows?: number[], columns?: number[] } | undefined,
 * }} deps
 */
export function createDrags(deps) {
  return {
    /**
     * The rows a press drags: the selected block when the press is in it, else the row under it.
     * @param {Press} press
     * @returns {DragStart | undefined}
     */
    rowsDrag({ row, col, record = false }) {
      const shown = deps.current();
      const set = shown?.shown?.tabs[shown.tab]?.set;
      const picked = deps.selection();
      if (!shown || !set || !picked?.sorted) return undefined;
      const all = set.columns.map((_, i) => i);
      const inBlock =
        !record && picked.rows?.includes(row) && picked.columns?.includes(col) && picked.columns;
      const rows = record
        ? picked.sorted.slice(0, 1)
        : inBlock
          ? (picked.rows ?? []).map((i) => picked.sorted?.[i])
          : [picked.sorted[row]];
      if (rows.length === 0 || rows.some((r) => !r)) return undefined;
      const full = /** @type {(string | null)[][]} */ (rows);
      const columns = inBlock || all;
      const conn = deps.connection(shown.connection);
      const target = shown.edit?.target;
      const table = shown.table ?? (target ? { schema: target.schema, name: target.name } : null);
      const dialect = conn ? engineOf(conn.engine).dialect : "postgresql";
      const options = {
        dialect,
        table: table && conn ? tableName(conn, table.schema, table.name) : "t",
        rows: full,
        columns,
        ...(target ? { types: target.columns.map((c) => c.type) } : {}),
      };
      const value = {
        ...(conn ? { connection: conn.name, engine: conn.engine } : {}),
        ...(table ? { schema: table.schema, table: table.name } : {}),
        columns: columns.map((c) => set.columns[c] ?? ""),
        rows: full.map((r) => columns.map((c) => r[c] ?? null)),
      };
      return {
        items: [
          { type: "desk/json", kind: ROWS_KIND, value },
          { type: "desk/text", text: formatRows(set, "insert", options) },
          { type: "text/plain", text: formatRows(set, "tsv", options) },
        ],
        effectAllowed: ["copy"],
        image: {
          label: `${full.length} row${full.length === 1 ? "" : "s"}`,
          detail: table?.name ?? conn?.name ?? "result",
        },
      };
    },

    /**
     * A table of the explorer: its qualified name as text, quoted only where SQL needs it.
     * @param {Node | undefined} node
     * @returns {DragStart | undefined}
     */
    tableDrag(node) {
      const conn =
        node?.kind === "table" && node.table ? deps.connection(node.connection) : undefined;
      if (!node?.table || !conn) return undefined;
      const { dialect } = engineOf(conn.engine);
      const schema = conn.engine === "sqlite" ? "" : (node.schema ?? "");
      return {
        items: [{ type: "desk/text", text: readableName(dialect, schema, node.table, RESERVED) }],
        effectAllowed: ["copy", "link"],
        image: { label: node.table, detail: conn.name },
      };
    },
  };
}

/**
 * Take paths and text dropped on the surface.
 * @param {{ dnd?: PluginDnd }} ctx
 * @param {{ drop(item: import("./drops.js").Dropped, into?: import("./importer.js").Into): Promise<"none" | undefined>,
 *   say(text: string): void }} app
 * @param {DropView} view
 */
export function createDatabaseDrops({ dnd }, app, view) {
  /** A drop reads or imports a copy of what it is given; a link is enough for a path. */
  const effect = (/** @type {DragOver} */ over) => {
    const allowed = over.effectAllowed;
    if (allowed.includes("copy")) return "copy";
    return over.types.includes("desk/paths") && allowed.includes("link") ? "link" : "none";
  };
  dnd?.onDrop(
    view.dropTarget ?? {},
    (drop) => {
      const into = /** @type {import("./importer.js").Into | undefined} */ (
        view.targetOf?.(drop.element)
      );
      const paths = drop.paths ?? [];
      if (paths.length > 1) {
        app.say(`Drop one file at a time: these are ${paths.length}.`);
        return "none";
      }
      if (paths[0]) return app.drop({ kind: "file", path: paths[0].path }, into);
      return app.drop({ kind: "text", text: drop.text ?? "" });
    },
    { accept: ACCEPTS, at: (element) => view.landing?.(element) ?? element, effect },
  );
}
