// The ER diagram laid out (PG-55): each table's box sized by the columns it shows (all, keys only or
// none) and its name, placed (arrange.js: the kept positions stay, new tables beside them) and its
// foreign keys routed (route.js) from the rows of their columns. `solve` is what the worker runs
// for a large diagram (layout-worker.js), the frame for a small one (layout-client.js); `layoutOf`
// puts the boxes, lines and bounds together for the panel and the export. Pure.

import { t as messageText } from "../../strings/index.js";
import { place } from "./arrange.js";
import { routeAll } from "./route.js";

/**
 * @typedef {import("./model.js").Graph} Graph
 * @typedef {import("./model.js").Table} Table
 * @typedef {import("./model.js").Column} Column
 * @typedef {import("./model.js").End} End
 * @typedef {"all" | "keys" | "none"} Mode
 * @typedef {import("./route.js").Points} Points
 * @typedef {import("./route.js").Wire} Wire
 * @typedef {{
 *   id: string, schema: string, name: string, label: string, comment: string,
 *   x: number, y: number, w: number, h: number, rows: Column[], more: number,
 * }} Box
 * @typedef {{
 *   from: number, to: number, fromY: number, toY: number, name: string, title: string,
 *   drawn: boolean, ends: { from: End, to: End }, points: Points,
 * }} Line
 * @typedef {{ x: number, y: number, w: number, h: number }} Bounds
 * @typedef {{ boxes: Box[], lines: Line[], bounds: Bounds, mode: Mode }} Layout
 * @typedef {{ nodes: import("./arrange.js").Node[], edges: import("./arrange.js").Edge[], wires: Wire[], kept: [string, number, number][] }} Problem
 * @typedef {{ at: [string, number, number][], points: Points[] }} Solution
 */

export const MODES = /** @type {const} */ (["all", "keys", "none"]);
export const HEAD = 26;
export const LINE = 18;
export const PAD = 10;
export const TAG = 26;
/** The tag column when a row is both a primary and a foreign key ("PK FK"). */
const BOTH = 46;
const CHAR = 7.2;
const MIN_W = 140;
const MAX_W = 380;
export const MAX_ROWS = 50;

/** A column's type as the box shows it: "null" after it when the column may be NULL. */
export const typeText = (/** @type {Column} */ c) => (c.nullable ? `${c.type} null` : c.type);

/** The columns a table shows in a mode, and how many more it has. */
export function rowsOf(/** @type {Table} */ table, /** @type {Mode} */ mode) {
  const list =
    mode === "none"
      ? []
      : mode === "keys"
        ? table.columns.filter((c) => c.primary || c.foreign)
        : table.columns;
  const rows = list.slice(0, MAX_ROWS);
  return { rows, more: list.length - rows.length };
}

/** The width of a box's tag column (PK, FK): wider when a row is both. */
export const tagOf = (/** @type {Column[]} */ rows) =>
  rows.some((c) => c.primary && c.foreign) ? BOTH : TAG;

/** A box's size: as wide as its widest line (within bounds), as tall as its rows. */
export function sizeOf(/** @type {string} */ label, /** @type {Column[]} */ rows, more = 0) {
  const tag = tagOf(rows);
  const widest = Math.max(
    label.length * CHAR,
    ...rows.map((c) => tag + (c.name.length + typeText(c).length + 2) * CHAR),
  );
  const w = Math.round(Math.min(MAX_W, Math.max(MIN_W, widest + 2 * PAD)));
  const lines = rows.length + (more > 0 ? 1 : 0);
  return { w, h: HEAD + (lines ? lines * LINE + 8 : 0) };
}

/** Where a line meets a box, from its top: the row of its first column, else the head. */
const portY = (/** @type {Column[]} */ rows, /** @type {string[]} */ columns) => {
  const at = rows.findIndex((c) => c.name === columns[0]);
  return at < 0 ? HEAD / 2 : HEAD + 4 + at * LINE + LINE / 2;
};

/** A table's label: qualified when the diagram spans schemas. */
export const labelOf = (/** @type {Table} */ t, /** @type {boolean} */ multi) =>
  multi ? `${t.schema}.${t.name}` : t.name;

/**
 * What a graph needs laid out: its boxes' sizes, its links, its wires and the kept positions.
 * @param {Graph} graph
 * @param {Mode} mode
 * @param {Map<string, [number, number]>} kept
 */
export function problemOf(graph, mode, kept) {
  const multi = new Set(graph.tables.map((t) => t.schema)).size > 1;
  const boxes = graph.tables.map((t) => {
    const { rows, more } = rowsOf(t, mode);
    const label = labelOf(t, multi);
    return { table: t, label, rows, more, ...sizeOf(label, rows, more) };
  });
  const index = new Map(graph.tables.map((t, i) => [t.id, i]));
  const wires = graph.links.map((l) => {
    const from = /** @type {number} */ (index.get(l.from));
    const to = /** @type {number} */ (index.get(l.to));
    return {
      from,
      to,
      fromY: portY(boxes[from]?.rows ?? [], l.fromColumns),
      toY: portY(boxes[to]?.rows ?? [], l.toColumns),
    };
  });
  /** @type {Problem} */
  const problem = {
    nodes: boxes.map((b) => ({ id: b.table.id, w: b.w, h: b.h })),
    edges: graph.links.map((l) => ({ from: l.from, to: l.to })),
    wires,
    kept: graph.tables.flatMap((t) => {
      const at = kept.get(t.id);
      return at ? [/** @type {[string, number, number]} */ ([t.id, at[0], at[1]])] : [];
    }),
  };
  return { problem, boxes };
}

/** Positions and routes for a problem: what the worker answers. @returns {Solution} */
export function solve(/** @type {Problem} */ problem) {
  const kept = new Map(
    problem.kept.map(([id, x, y]) => [id, /** @type {[number, number]} */ ([x, y])]),
  );
  const at = place(problem.nodes, problem.edges, kept);
  const rects = problem.nodes.map((n) => {
    const [x, y] = at.get(n.id) ?? [0, 0];
    return { x: Math.round(x), y: Math.round(y), w: n.w, h: n.h };
  });
  const routes = routeAll(rects, problem.wires);
  return {
    at: problem.nodes.map((n, i) => [n.id, rects[i]?.x ?? 0, rects[i]?.y ?? 0]),
    points: problem.wires.map((_, i) => routes.get(i) ?? []),
  };
}

/**
 * The layout of a graph from a problem's solution.
 * @param {Graph} graph
 * @param {Mode} mode
 * @param {ReturnType<typeof problemOf>} made
 * @param {Solution} solution
 * @returns {Layout}
 */
export function layoutOf(graph, mode, made, solution) {
  const boxes = made.boxes.map((b, i) => {
    const [, x = 0, y = 0] = solution.at[i] ?? [];
    return {
      id: b.table.id,
      schema: b.table.schema,
      name: b.table.name,
      label: b.label,
      comment: b.table.comment,
      x,
      y,
      w: b.w,
      h: b.h,
      rows: b.rows,
      more: b.more,
    };
  });
  const lines = graph.links.map((l, i) => {
    const wire = /** @type {Wire} */ (made.problem.wires[i]);
    const ends = `${boxes[wire.from]?.label}${l.fromColumns.length ? ` (${l.fromColumns.join(", ")})` : ""} → ${boxes[wire.to]?.label}${l.toColumns.length ? ` (${l.toColumns.join(", ")})` : ""}`;
    return {
      ...wire,
      name: l.name,
      title: l.drawn
        ? messageText("features.diagram.layout.notInTheDatabase", { ends: String(ends) })
        : `${ends} · ${l.name}`,
      drawn: l.drawn,
      ends: l.ends,
      points: solution.points[i] ?? [],
    };
  });
  return { boxes, lines, bounds: boundsOf(boxes, lines), mode };
}

/** What a layout covers: its boxes and its lines' routes. @returns {Bounds} */
export function boundsOf(/** @type {Box[]} */ boxes, /** @type {Line[]} */ lines) {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let [lx, ly, hx, hy] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    lx = Math.min(lx, b.x);
    ly = Math.min(ly, b.y);
    hx = Math.max(hx, b.x + b.w);
    hy = Math.max(hy, b.y + b.h);
  }
  for (const l of lines)
    for (const [x, y] of l.points) {
      lx = Math.min(lx, x);
      ly = Math.min(ly, y);
      hx = Math.max(hx, x);
      hy = Math.max(hy, y);
    }
  return { x: lx, y: ly, w: hx - lx, h: hy - ly };
}

/**
 * Move boxes and route again the lines that touch them, in place: what a drag or a key does.
 * @param {Layout} layout
 * @param {Map<number, [number, number]>} moves Box index to its new position.
 */
export function moveBoxes(layout, moves) {
  for (const [i, [x, y]] of moves) {
    const box = layout.boxes[i];
    if (box) Object.assign(box, { x: Math.round(x), y: Math.round(y) });
  }
  const touched = new Set(
    layout.lines.flatMap((l, i) => (moves.has(l.from) || moves.has(l.to) ? [i] : [])),
  );
  for (const [i, points] of routeAll(layout.boxes, layout.lines, touched)) {
    const line = layout.lines[i];
    if (line) line.points = points;
  }
  layout.bounds = boundsOf(layout.boxes, layout.lines);
  return touched;
}
