// @vitest-environment jsdom
// A plugin's section in a shell window's pane (ADR 0040) fills the pane. The compositor's grid cell
// of a surface (a layout kept from before the window host, a session restore, a move) must never
// reach a section a window holds: inline grid placement in the pane's one-cell grid drops it into
// implicit tracks, offset and clipped (#538, the terminal drawn from a third of the way across).
import { expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { type Cell, LAYOUT_KEY } from "../layout";
import { createRuntime } from "../runtime";
import { emptyState, Store } from "../shell/state";
import { pluginWindows } from "./host";

const ID = "endue.terminal";
const CELLS: Cell[] = [
  { col: 2, row: 2, colSpan: 1, rowSpan: 1 },
  { col: 3, row: 1, colSpan: 1, rowSpan: 2 },
  { col: 1, row: 2, colSpan: 2, rowSpan: 1 },
];

/** A layout an earlier desk saved, with a grid cell for the surface the shell now windows. */
function storage(cell: Cell) {
  const saved = { version: 1, columns: 3, rows: 2, cells: { [ID]: cell } };
  const items = new Map([[LAYOUT_KEY, JSON.stringify(saved)]]);
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

const placement = (section: HTMLElement) => ({
  column: section.style.gridColumn,
  row: section.style.gridRow,
  area: section.style.gridArea,
});
const NONE = { column: "", row: "", area: "" };

it("a section adopted into a window pane has no grid placement, whatever its compositor cell was", async () => {
  for (const cell of CELLS) {
    const root = document.createElement("div");
    document.body.append(root);
    const store = new Store(emptyState("en"));
    const windows = pluginWindows(store);
    const runtime = createRuntime({
      root,
      bridge: browserCore({ manifests: [] }).client,
      clock: new ManualClock(),
      storage: storage(cell),
      windows,
    });
    try {
      await runtime.ready;
      runtime.openSurface({ id: ID, title: "Terminal", placement: "center" });
      const pane = windows.body(ID);
      document.body.append(pane);
      const section = pane.querySelector<HTMLElement>(`.desk-surface[data-surface="${ID}"]`);
      if (!section) throw new Error("the pane did not take the section");
      expect(pane.classList.contains("plugin-pane")).toBe(true);
      expect(section.classList.contains("desk-surface--windowed")).toBe(true);
      expect([...pane.children]).toEqual([section]);
      // Every later layout change places the grid's surfaces again: a windowed one stays unplaced.
      runtime.moveSurface(ID, cell);
      runtime.moveSurface("another.plugin", { col: 1, row: 1, colSpan: 1, rowSpan: 1 });
      expect(placement(section), JSON.stringify(cell)).toEqual(NONE);
      expect(section.parentElement).toBe(pane);
      pane.remove();
    } finally {
      runtime.dispose();
      root.remove();
    }
  }
});

it("the window host takes away a placement a section brought with it", () => {
  const store = new Store(emptyState("en"));
  const windows = pluginWindows(store);
  const pane = windows.body(ID);
  const section = document.createElement("section");
  section.className = "desk-surface desk-surface--windowed";
  section.style.gridColumn = "2 / span 1";
  section.style.gridRow = "2 / span 1";
  windows.adopt({ id: ID, title: "Terminal" }, section);
  expect(section.parentElement).toBe(pane);
  expect(placement(section)).toEqual(NONE);
  expect(store.get().adopted.map((a) => a.id)).toEqual([ID]);
});

it("a surface on the compositor's grid still takes its cell", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const runtime = createRuntime({
    root,
    bridge: browserCore({ manifests: [] }).client,
    clock: new ManualClock(),
    storage: storage({ col: 2, row: 2, colSpan: 1, rowSpan: 1 }),
  });
  try {
    await runtime.ready;
    runtime.openSurface({ id: ID, title: "Terminal", placement: "center" });
    const section = root.querySelector<HTMLElement>(`.desk-surface[data-surface="${ID}"]`);
    if (!section) throw new Error("no section on the grid");
    expect(section.style.gridColumn).toMatch(/^2\b/);
    expect(section.style.gridRow).toMatch(/^2\b/);
  } finally {
    runtime.dispose();
    root.remove();
  }
});
