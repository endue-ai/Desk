// An ER diagram's DOM (item 9): an SVG of the schema's tables as boxes of columns (keys marked)
// and its foreign keys as lines with an arrow at the table they refer to. Each table is a button
// in the tab order; the arrow keys move between them, Enter opens its rows. Colours come from the
// theme through the stylesheet's classes.

import { METRICS } from "./schema/diagram.js";

/**
 * @typedef {import("./schema/diagram.js").Layout} Layout
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const SVG = "http://www.w3.org/2000/svg";

/**
 * @param {Document} doc
 * @param {Layout} layout
 * @param {(table: string) => void} open Opens a table's rows.
 */
export function diagramView(doc, layout, open) {
  const make = (
    /** @type {string} */ tag,
    /** @type {Record<string, string | number>} */ attrs = {},
    text = "",
  ) => {
    const node = doc.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    if (text) node.textContent = text;
    return node;
  };
  const svg = make("svg", {
    class: "er",
    width: layout.width,
    height: layout.height,
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    role: "group",
    "aria-label": `${layout.boxes.length} tables, ${layout.edges.length} foreign keys`,
  });
  const defs = make("defs");
  const marker = make("marker", {
    id: "er-arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 7,
    markerHeight: 7,
    orient: "auto-start-reverse",
  });
  marker.append(make("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "er-arrow" }));
  defs.append(marker);
  svg.append(defs);
  for (const { link, points } of layout.edges) {
    const path = make("polyline", {
      points: points.map((p) => p.join(",")).join(" "),
      class: "er-link",
      "marker-end": "url(#er-arrow)",
    });
    path.append(
      make("title", {}, `${link.from} (${link.fromColumns}) → ${link.to} (${link.toColumns})`),
    );
    svg.append(path);
  }
  /** @type {SVGGElement[]} */
  const tables = [];
  for (const box of layout.boxes) {
    const linked = layout.edges.filter(
      (e) => e.link.from === box.name || e.link.to === box.name,
    ).length;
    const group = /** @type {SVGGElement} */ (
      make("g", {
        class: "er-table",
        tabindex: 0,
        role: "button",
        "aria-label": `${box.name}: ${box.columns.length} columns, ${linked} links. Enter opens its rows.`,
        transform: `translate(${box.x},${box.y})`,
      })
    );
    group.append(make("rect", { width: box.w, height: box.h, rx: 6, class: "er-box" }));
    group.append(make("rect", { width: box.w, height: METRICS.HEAD, rx: 6, class: "er-head" }));
    group.append(make("text", { x: 10, y: 17, class: "er-name" }, box.name));
    box.columns.slice(0, box.columns.length - box.more).forEach((column, i) => {
      const y = METRICS.HEAD + 14 + i * METRICS.LINE;
      group.append(
        make(
          "text",
          { x: 10, y, class: column.key ? "er-column er-key" : "er-column" },
          `${column.key ? "PK " : ""}${column.name}`,
        ),
      );
      group.append(
        make("text", { x: box.w - 10, y, class: "er-type", "text-anchor": "end" }, column.type),
      );
    });
    if (box.more > 0) {
      const y = METRICS.HEAD + 14 + (box.columns.length - box.more) * METRICS.LINE;
      group.append(make("text", { x: 10, y, class: "er-type" }, `… ${box.more} more`));
    }
    group.addEventListener("keydown", (event) => {
      const at = tables.indexOf(group);
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(box.name);
      } else if (step) {
        event.preventDefault();
        tables[Math.max(0, Math.min(tables.length - 1, at + step))]?.focus();
      }
    });
    group.addEventListener("dblclick", () => open(box.name));
    tables.push(group);
    svg.append(group);
  }
  const host = doc.createElement("div");
  host.className = "diagram";
  host.append(svg);
  if (layout.boxes.length === 0) {
    const empty = doc.createElement("p");
    empty.className = "empty";
    empty.textContent = "No tables in this schema.";
    host.append(empty);
  }
  return host;
}
