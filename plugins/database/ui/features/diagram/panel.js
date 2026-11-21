// The ER diagram panel's DOM (PG-55): a bar of tools (Auto layout, Fit, zoom, the columns shown,
// Add table, Add schema, Draw relation, Export, Copy image) and what the diagram holds, over the
// stage (stage.js) and its map (minimap.js). Each table is a button in the tab order: the arrows
// move between tables, Shift with an arrow moves the table, Enter opens its rows, Delete takes it
// out of the diagram, n adds its neighbours; + - and 0 zoom and fit, a lays the tables out again.
// A new state of the same diagram draws in place and keeps the view and the focus.

import { createExportMenu } from "./export-menu.js";
import { createMap } from "./minimap.js";
import { createStage } from "./stage.js";

/**
 * @typedef {import("./read.js").DiagramState} DiagramState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const STEP = 8;
const PAN = 48;
const ARROWS = /** @type {Record<string, [number, number]>} */ ({
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
});

/**
 * @param {Document} doc
 * @param {DiagramState} first
 * @param {Act} act
 * @param {{ id: string, connection: string }} buffer
 */
export function diagramPanel(doc, first, act, buffer) {
  let state = first;
  const make = (/** @type {string} */ tag, /** @type {string} */ cls = "", text = "") => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const button = (
    /** @type {string} */ text,
    /** @type {string} */ title,
    /** @type {() => unknown} */ press,
    /** @type {"desk-tab" | "desk-icon-btn" | undefined} */ kind = undefined,
  ) => {
    const node = /** @type {HTMLButtonElement} */ (make("button", "desk-btn desk-btn-quiet", text));
    if (kind) node.className = kind;
    node.type = "button";
    node.title = title;
    node.addEventListener("click", () => void press());
    return node;
  };
  const run = (/** @type {string} */ action, /** @type {unknown[]} */ ...args) =>
    act(action, buffer.id, ...args);

  const root = make("div", "diagram");
  const bar = make("div", "desk-bar er-bar");
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "ER diagram");
  const columns = make("div", "desk-tabs er-columns");
  columns.setAttribute("role", "group");
  columns.setAttribute("aria-label", "Columns shown");
  const modes = /** @type {const} */ ([
    ["all", "All", "Every column"],
    ["keys", "Keys", "Primary and foreign key columns only"],
    ["none", "None", "Table names only"],
  ]).map(([mode, label, title]) => {
    const b = button(label, title, () => run("diagramColumns", mode), "desk-tab");
    b.dataset.mode = mode;
    columns.append(b);
    return b;
  });
  const out = button("−", "Zoom out (-)", () => stage.zoom(1 / 1.25), "desk-icon-btn");
  out.setAttribute("aria-label", "Zoom out");
  const into = button("+", "Zoom in (+)", () => stage.zoom(1.25), "desk-icon-btn");
  into.setAttribute("aria-label", "Zoom in");
  const exporting = button("Export image…", "Save as SVG or PNG", () => menu.open(exporting));
  exporting.setAttribute("aria-haspopup", "menu");
  const status = make("span", "er-count");
  status.setAttribute("role", "status");
  bar.append(
    button("Auto layout", "Lay every table out again (a)", () => run("diagramArrange")),
    button("Fit", "Show the whole diagram (0)", () => stage.fitAll()),
    out,
    into,
    columns,
    button("Add table", "Add a table to the diagram", () => run("diagramAdd")),
    button("Add schema", "Add a schema's tables", () => run("diagramAddSchema")),
    button("Draw relation", "Draw a relation the database does not declare", () =>
      run("diagramRelation"),
    ),
    exporting,
    button("Copy image", "Copy as a PNG", () => run("diagramCopy")),
    make("span", "desk-bar-spacer"),
    status,
  );
  const host = make("div", "er-stage");
  const empty = make("p", "empty", "No tables in this diagram: Add table or Add schema adds some.");
  root.append(bar, host, empty);
  const menu = createExportMenu(doc, root, (choice) =>
    choice === "copy" ? run("diagramCopy") : run("diagramExport", choice),
  );

  const stage = createStage(doc, host, {
    moved: (moves) => run("diagramMoved", moves),
    viewed: (view, size) => map.show(view, size),
  });
  const map = createMap(doc, host, (x, y) => stage.center(x, y));

  /** The tools and the counts for a state. */
  const describe = (/** @type {DiagramState} */ s) => {
    for (const b of modes) b.setAttribute("aria-pressed", String(b.dataset.mode === s.layout.mode));
    const { tables, links, drawn } = s.counts;
    status.textContent = [
      `${tables} tables`,
      `${links} foreign keys`,
      ...(drawn ? [`${drawn} drawn (dashed: not in the database)`] : []),
      ...(s.kept ? [] : ["not kept: too large"]),
    ].join(" · ");
    empty.hidden = s.layout.boxes.length > 0;
  };
  /** @param {DiagramState} s @param {boolean} fitted */
  const draw = (s, fitted) => {
    const focused = doc.activeElement?.closest?.("g.er-table");
    const was = focused
      ? state.layout.boxes[Number(focused.getAttribute("data-b"))]?.id
      : undefined;
    state = s;
    stage.draw(s.layout, fitted);
    map.draw(s.layout);
    describe(s);
    if (was) {
      const i = s.layout.boxes.findIndex((b) => b.id === was);
      if (i >= 0) stage.table(i)?.focus();
    }
  };

  /** The table nearest the focused one in a direction. */
  const nearest = (/** @type {number} */ from, /** @type {[number, number]} */ [dx, dy]) => {
    const boxes = state.layout.boxes;
    const a = boxes[from];
    if (!a) return -1;
    const [ax, ay] = [a.x + a.w / 2, a.y + a.h / 2];
    let best = -1;
    let low = Infinity;
    boxes.forEach((b, i) => {
      if (i === from) return;
      const [ox, oy] = [b.x + b.w / 2 - ax, b.y + b.h / 2 - ay];
      const ahead = ox * dx + oy * dy;
      if (ahead <= 0) return;
      const score = ahead + 2 * Math.abs(ox * dy - oy * dx);
      if (score < low) {
        low = score;
        best = i;
      }
    });
    return best;
  };

  const key = (/** @type {KeyboardEvent} */ event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/** @type {Element} */ (event.target).closest?.(".er-bar")) return;
    const table = /** @type {Element} */ (event.target).closest?.("g.er-table");
    const at = table ? Number(table.getAttribute("data-b")) : -1;
    const box = state.layout.boxes[at];
    const arrow = ARROWS[event.key];
    let done = true;
    if (arrow && box && event.shiftKey) {
      stage.move(new Map([[at, [box.x + arrow[0] * STEP, box.y + arrow[1] * STEP]]]));
      run("diagramMoved", [[box.id, box.x, box.y]]);
    } else if (arrow && box) {
      const next = nearest(at, arrow);
      if (next >= 0) stage.table(next)?.focus();
    } else if (arrow) stage.panBy(-arrow[0] * PAN, -arrow[1] * PAN);
    else if ((event.key === "Enter" || event.key === " ") && box)
      act("openTable", buffer.connection, box.schema, box.name);
    else if ((event.key === "Delete" || event.key === "Backspace") && box)
      run("diagramRemove", box.id);
    else if (event.key === "n" && box) run("diagramExpand", box.id);
    else if (event.key === "+" || event.key === "=") stage.zoom(1.25);
    else if (event.key === "-") stage.zoom(1 / 1.25);
    else if (event.key === "0") stage.fitAll();
    else if (event.key === "a") run("diagramArrange");
    else done = false;
    if (done) event.preventDefault();
  };
  const open = (/** @type {MouseEvent} */ event) => {
    const table = /** @type {Element} */ (event.target).closest?.("g.er-table");
    const box = table ? state.layout.boxes[Number(table.getAttribute("data-b"))] : undefined;
    if (box) act("openTable", buffer.connection, box.schema, box.name);
  };
  host.addEventListener("keydown", key);
  // A move waits a moment before it is kept: the page going away keeps it now.
  const win = doc.defaultView;
  const away = () => run("diagramFlush");
  win?.addEventListener("pagehide", away);
  host.addEventListener("dblclick", open);
  draw(first, true);

  return {
    el: root,
    update(/** @type {DiagramState} */ next) {
      if (next.layout === state.layout) {
        state = next;
        describe(next);
        return;
      }
      draw(next, (next.arranged ?? 0) !== (state.arranged ?? 0));
    },
    destroy() {
      win?.removeEventListener("pagehide", away);
      run("diagramFlush");
      host.removeEventListener("keydown", key);
      host.removeEventListener("dblclick", open);
      stage.destroy();
      map.destroy();
      menu.destroy();
    },
    /** The stage, for tests. */
    stage,
  };
}
