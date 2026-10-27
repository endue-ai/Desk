import { describe, expect, it } from "vitest";
import { defaultLayout, type Layout, loadLayout, place, saveLayout } from "./layout";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe("layout", () => {
  it("round-trips through storage", () => {
    const storage = memoryStorage();
    const layout: Layout = {
      ...defaultLayout(),
      cells: { notes: { col: 2, row: 1, colSpan: 1, rowSpan: 2 } },
    };
    saveLayout(storage, layout);
    expect(loadLayout(storage)).toEqual(layout);
  });

  it("falls back to the default layout on missing or bad data", () => {
    const storage = memoryStorage();
    expect(loadLayout(storage)).toEqual(defaultLayout());
    storage.setItem("desk.layout", "{not json");
    expect(loadLayout(storage)).toEqual(defaultLayout());
    storage.setItem("desk.layout", JSON.stringify({ version: 99, columns: 3, rows: 2, cells: {} }));
    expect(loadLayout(storage)).toEqual(defaultLayout());
    const outside = { version: 1, columns: 3, rows: 2, cells: { a: { col: 4, row: 1, colSpan: 1, rowSpan: 1 } } };
    storage.setItem("desk.layout", JSON.stringify(outside));
    expect(loadLayout(storage)).toEqual(defaultLayout());
  });

  it("places a new surface in the first free cell, row by row", () => {
    let layout = defaultLayout();
    layout = place(layout, "a");
    layout = place(layout, "b");
    expect(layout.cells.a).toEqual({ col: 1, row: 1, colSpan: 1, rowSpan: 1 });
    expect(layout.cells.b).toEqual({ col: 2, row: 1, colSpan: 1, rowSpan: 1 });
  });

  it("keeps the cell of a surface that is already placed", () => {
    const layout = place(place(defaultLayout(), "a"), "a");
    expect(Object.keys(layout.cells)).toEqual(["a"]);
  });
});
