// The DOM half of the Database surface's drag and drop (dnd.js, ADR 0119). Cells of the result drag
// their rows (the selected block when the press is in it) and tables of the explorer their name,
// past the SDK's movement threshold, so a click still moves the cursor and a double click still
// edits. A drop lands on an explorer table (a file is imported into it) or on the work area.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginDnd} PluginDnd
 * @typedef {import("./explorer.js").Node} Node
 * @typedef {{
 *   rowsDrag(press: import("./dnd.js").Press): import("@endue-ai/plugin-sdk").DragStart | undefined,
 *   tableDrag(node: Node | undefined): import("@endue-ai/plugin-sdk").DragStart | undefined,
 * }} Drags
 */

/**
 * @param {Document} doc
 * @param {PluginDnd | undefined} dnd
 * @param {Drags} app
 * @param {{ nodeAt(target: unknown): Node | undefined }} view
 */
export function createDropView(doc, dnd, app, view) {
  const main = /** @type {HTMLElement | null} */ (doc.querySelector("main"));
  const work = doc.getElementById("work");
  const grid = doc.getElementById("result");
  const tree = doc.getElementById("tree");
  const asElement = (/** @type {unknown} */ node) => (node instanceof Element ? node : null);
  /** A table row of the explorer an element is in. */
  const tableAt = (/** @type {unknown} */ node) => {
    const row = asElement(node)?.closest("[role=treeitem]");
    const found = row && tree?.contains(row) ? view.nodeAt(row) : undefined;
    return found?.kind === "table" && found.table ? { row, node: found } : undefined;
  };

  if (dnd && grid)
    dnd.draggable(grid, {
      item: (target) => {
        const element = asElement(target);
        // A cell being edited keeps its own pointer: selecting text there is not a drag.
        if (!element || element.closest("input, textarea, [contenteditable]")) return undefined;
        const cell = element.closest("[role=gridcell]");
        const line = cell?.closest("[role=row]");
        if (!cell || !line) return undefined;
        return app.rowsDrag({
          row: Number(line.getAttribute("aria-rowindex")) - 2,
          col: Number(cell.getAttribute("aria-colindex")) - 1,
          record: doc.getElementById("record")?.getAttribute("aria-pressed") === "true",
        });
      },
    });
  if (dnd && tree) dnd.draggable(tree, { item: (target) => app.tableDrag(tableAt(target)?.node) });

  return {
    dropTarget: main ?? {},
    /** An explorer table, or the work area: the element ctx.dnd marks. */
    landing: (/** @type {unknown} */ element) => tableAt(element)?.row ?? work ?? main,
    /** The table a file dropped there goes into. */
    targetOf(/** @type {unknown} */ element) {
      const node = tableAt(element)?.node;
      return node?.table
        ? { connection: node.connection, schema: node.schema ?? "", table: node.table }
        : undefined;
    },
  };
}
