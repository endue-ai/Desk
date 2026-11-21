// @vitest-environment jsdom
// The ER diagram panel on jsdom (PG-55, ui/features/diagram/{panel,stage,minimap}.js): a table
// dragged by the pointer and moved by Shift and the arrows reports where it went and its lines
// follow; the arrows move between tables; zoom in, out and Fit change the view; the map shows past
// 30 tables and moves the view; far out the column rows are not drawn, and only boxes near the view
// are displayed; Enter, Delete, n and the tools call their actions; a new state keeps the focus.
import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import { MAP_FROM } from "../ui/features/diagram/minimap.js";
import { type Graph, idOf } from "../ui/features/diagram/model.js";
import { diagramPanel } from "../ui/features/diagram/panel.js";
import { type DiagramState, stateOf } from "../ui/features/diagram/read.js";
import { FAR } from "../ui/features/diagram/stage.js";

const CONN = { id: "c-prod", name: "Shop" } as Connection;
const BUFFER = { id: "b-1", connection: "c-prod", name: "er: Shop · public" };

function graphOf(count: number, links: [number, number][]): Graph {
  const names = Array.from({ length: count }, (_, i) => `t${i}`);
  return {
    tables: names.map((name) => ({
      id: idOf("public", name),
      schema: "public",
      name,
      comment: name === "t0" ? "The first" : "",
      columns: [
        {
          name: "id",
          type: "integer",
          nullable: false,
          primary: true,
          foreign: false,
          comment: "",
        },
        {
          name: "ref",
          type: "integer",
          nullable: true,
          primary: false,
          foreign: true,
          comment: "",
        },
        { name: "note", type: "text", nullable: true, primary: false, foreign: false, comment: "" },
      ],
    })),
    links: links.map(([a, b], i) => ({
      name: `k${i}`,
      from: idOf("public", names[a] as string),
      to: idOf("public", names[b] as string),
      fromColumns: ["ref"],
      toColumns: ["id"],
      drawn: false,
      ends: { from: "many", to: "zero-one" },
    })),
  };
}
const stateFor = (graph: Graph) =>
  stateOf(
    CONN,
    "public",
    graph,
    {
      choice: { schemas: ["public"] },
      mode: "all",
      at: [],
      added: [],
      removed: [],
      drawn: [],
    },
    { schemas: ["public"] },
  );

async function drawn(graph: Graph) {
  document.body.innerHTML = "";
  const act = vi.fn();
  const state = await stateFor(graph);
  const handle = diagramPanel(document, state, act, BUFFER);
  document.body.append(handle.el);
  handle.stage.flush();
  return { act, state, handle, table: (i: number) => handle.stage.table(i) as SVGGElement };
}
const pointer = (type: string, x: number, y: number) =>
  new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
const key = (el: Element, k: string, shift = false) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true }));

describe("the diagram panel", () => {
  it("moves, zooms and maps", async () => {
    const { act, state, handle, table } = await drawn(
      graphOf(3, [
        [1, 0],
        [2, 0],
      ]),
    );
    const root = handle.el;
    expect(root.querySelectorAll("g.er-table")).toHaveLength(3);
    expect(root.querySelectorAll("g.er-link")).toHaveLength(2);
    expect(root.querySelector(".er-count")?.textContent).toBe("3 tables · 2 foreign keys");
    expect(root.querySelector("g.er-table title")?.textContent).toBe("t0: The first");
    expect(root.querySelector(".er-row title")?.textContent).toBe(
      "id: integer, not null, primary key",
    );
    expect(root.querySelector(".er-map")?.hasAttribute("hidden")).toBe(true);

    // A pointer drag on a table moves it; its lines follow; the move is reported once, at the end.
    const k = handle.stage.view().k;
    const box = state.layout.boxes[1];
    const [x0, y0] = [box?.x ?? 0, box?.y ?? 0];
    const before = root.querySelector('g.er-link[data-l="0"] polyline')?.getAttribute("points");
    table(1).dispatchEvent(pointer("pointerdown", 100, 100));
    handle.stage.svg.dispatchEvent(pointer("pointermove", 180, 140));
    handle.stage.svg.dispatchEvent(pointer("pointerup", 180, 140));
    const snap = (v: number) => Math.round(v / 4) * 4;
    const moved = [snap(x0 + 80 / k), snap(y0 + 40 / k)];
    expect(act).toHaveBeenCalledWith("diagramMoved", "b-1", [[box?.id, ...moved]]);
    expect(table(1).getAttribute("transform")).toBe(`translate(${moved[0]},${moved[1]})`);
    expect(root.querySelector('g.er-link[data-l="0"] polyline')?.getAttribute("points")).not.toBe(
      before,
    );

    // Shift with an arrow moves the focused table by 8; an arrow alone moves the focus.
    table(1).focus();
    key(table(1), "ArrowRight", true);
    expect(act).toHaveBeenLastCalledWith("diagramMoved", "b-1", [
      [box?.id, (moved[0] ?? 0) + 8, moved[1]],
    ]);
    const leftmost = state.layout.boxes.reduce(
      (a, b, i) => (b.x < (state.layout.boxes[a]?.x ?? 0) ? i : a),
      0,
    );
    table(leftmost).focus();
    key(table(leftmost), "ArrowRight");
    expect(document.activeElement).not.toBe(table(leftmost));
    expect(document.activeElement?.classList.contains("er-table")).toBe(true);

    // Enter, Delete and n call their actions; the tools too.
    key(table(0), "Enter");
    expect(act).toHaveBeenCalledWith("openTable", "c-prod", "public", "t0");
    key(table(0), "Delete");
    expect(act).toHaveBeenCalledWith("diagramRemove", "b-1", idOf("public", "t0"));
    key(table(0), "n");
    expect(act).toHaveBeenCalledWith("diagramExpand", "b-1", idOf("public", "t0"));
    const tool = (text: string) =>
      [...root.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
    tool("Auto layout").click();
    tool("Keys").click();
    tool("Copy image").click();
    tool("Draw relation").click();
    for (const name of ["diagramArrange", "diagramCopy", "diagramRelation"])
      expect(act).toHaveBeenCalledWith(name, "b-1");
    expect(act).toHaveBeenCalledWith("diagramColumns", "b-1", "keys");
    // Export opens a menu of formats; a format exports, the last item copies.
    const menu = root.querySelector(".er-export-menu") as HTMLElement;
    expect(menu.hidden).toBe(true);
    tool("Export image…").click();
    expect(menu.hidden).toBe(false);
    const items = [...menu.querySelectorAll("[role=menuitem]")] as HTMLElement[];
    expect(items.map((i) => i.textContent)).toEqual([
      "Export as SVG, vector…",
      "Export as PNG…",
      "Export as PNG at 2x…",
      "Copy as an image",
    ]);
    const choose = (item: HTMLElement | undefined) =>
      menu.dispatchEvent(new CustomEvent("desk-select", { detail: { item } }));
    choose(items[2]);
    expect(menu.hidden).toBe(true);
    expect(act).toHaveBeenLastCalledWith("diagramExport", "b-1", "png2x");
    choose(items[3]);
    expect(act).toHaveBeenLastCalledWith("diagramCopy", "b-1");
    expect(tool("All").getAttribute("aria-pressed")).toBe("true");

    // Zoom in, out and Fit.
    tool("Fit").click();
    handle.stage.flush();
    const fitted = handle.stage.view().k;
    key(table(0), "+");
    expect(handle.stage.view().k).toBeCloseTo(fitted * 1.25);
    key(table(0), "-");
    key(table(0), "-");
    expect(handle.stage.view().k).toBeCloseTo(fitted / 1.25);
    key(table(0), "0");
    expect(handle.stage.view().k).toBeCloseTo(fitted);

    // A new state of the same diagram draws in place and keeps the focus on its table.
    table(2).focus();
    const next: DiagramState = await stateFor(
      graphOf(4, [
        [1, 0],
        [2, 0],
      ]),
    );
    handle.update(next);
    expect(root.querySelectorAll("g.er-table")).toHaveLength(4);
    expect(document.activeElement).toBe(table(2));
    handle.destroy();
  });

  it("shows a map past 30 tables, hides the rows far out and displays only what is near", async () => {
    const count = MAP_FROM + 30;
    const links = Array.from(
      { length: count - 1 },
      (_, i) => [i + 1, Math.floor(i / 3)] as [number, number],
    );
    const { handle } = await drawn(graphOf(count, links));
    const root = handle.el;
    const map = root.querySelector(".er-map") as SVGSVGElement;
    expect(map.hasAttribute("hidden")).toBe(false);
    expect(map.querySelector(".er-map-boxes")?.getAttribute("d")?.match(/M/gu)).toHaveLength(count);
    const before = handle.stage.view();
    map.dispatchEvent(pointer("pointerdown", 5, 5));
    handle.stage.flush();
    expect(handle.stage.view()).not.toEqual(before);
    expect(map.querySelector(".er-map-view")?.getAttribute("width")).not.toBeNull();

    // Far out: no column rows.
    for (let i = 0; i < 30 && handle.stage.view().k >= FAR; i++) handle.stage.zoom(0.8);
    handle.stage.flush();
    expect(handle.stage.svg.classList.contains("er-far")).toBe(true);
    // Close in on one corner: the boxes far from the view are not displayed.
    handle.stage.zoom(40);
    handle.stage.center(0, 0);
    handle.stage.flush();
    const hidden = root.querySelectorAll('g.er-table[display="none"]').length;
    expect(hidden).toBeGreaterThan(count / 2);
    expect(handle.stage.svg.classList.contains("er-far")).toBe(false);
    handle.destroy();
  });
});
