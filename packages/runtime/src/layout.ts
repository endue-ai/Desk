/** Grid layout of the 2D desk: where each surface sits. Saved per desk, restored on start. */
export interface Cell {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export interface Layout {
  version: 1;
  columns: number;
  rows: number;
  cells: Record<string, Cell>;
}

export type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

export const LAYOUT_KEY = "desk.layout";
const MAX_TRACKS = 12;

export function defaultLayout(): Layout {
  return { version: 1, columns: 3, rows: 2, cells: {} };
}

export function saveLayout(storage: LayoutStorage, layout: Layout): void {
  storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
}

/** The saved layout, or the default when nothing valid is stored. */
export function loadLayout(storage: LayoutStorage): Layout {
  try {
    const raw = storage.getItem(LAYOUT_KEY);
    if (raw === null) return defaultLayout();
    const value: unknown = JSON.parse(raw);
    return isLayout(value) ? value : defaultLayout();
  } catch {
    return defaultLayout();
  }
}

/**
 * Put `id` in the first free region of `size` cells (1×1 by default), row by row. A placed surface
 * keeps its cell. A size larger than the grid is cut to fit; with no free region it takes the top left.
 */
export function place(
  layout: Layout,
  id: string,
  size: { colSpan?: number; rowSpan?: number } = {},
): Layout {
  if (layout.cells[id]) return layout;
  const colSpan = Math.min(Math.max(1, size.colSpan ?? 1), layout.columns);
  const rowSpan = Math.min(Math.max(1, size.rowSpan ?? 1), layout.rows);
  const taken = Object.values(layout.cells);
  for (let row = 1; row + rowSpan - 1 <= layout.rows; row++) {
    for (let col = 1; col + colSpan - 1 <= layout.columns; col++) {
      const region = { col, row, colSpan, rowSpan };
      if (!taken.some((cell) => overlaps(cell, region))) {
        return { ...layout, cells: { ...layout.cells, [id]: region } };
      }
    }
  }
  return {
    ...layout,
    cells: { ...layout.cells, [id]: { col: 1, row: 1, colSpan, rowSpan } },
  };
}

/** Move `id` to `cell`. Throws when the cell does not fit the grid. */
export function move(layout: Layout, id: string, cell: Cell): Layout {
  if (!fits(cell, layout)) throw new RangeError(`cell ${JSON.stringify(cell)} is outside the grid`);
  return { ...layout, cells: { ...layout.cells, [id]: { ...cell } } };
}

export function remove(layout: Layout, id: string): Layout {
  const { [id]: _removed, ...cells } = layout.cells;
  return { ...layout, cells };
}

function overlaps(a: Cell, b: Cell): boolean {
  return (
    a.col < b.col + b.colSpan &&
    b.col < a.col + a.colSpan &&
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan
  );
}

const isTrack = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1;

function fits(cell: Cell, layout: Pick<Layout, "columns" | "rows">): boolean {
  return (
    [cell.col, cell.row, cell.colSpan, cell.rowSpan].every(isTrack) &&
    cell.col + cell.colSpan - 1 <= layout.columns &&
    cell.row + cell.rowSpan - 1 <= layout.rows
  );
}

function isLayout(value: unknown): value is Layout {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<Layout>;
  if (v.version !== 1 || !isTrack(v.columns) || !isTrack(v.rows)) return false;
  if (v.columns > MAX_TRACKS || v.rows > MAX_TRACKS) return false;
  if (typeof v.cells !== "object" || v.cells === null) return false;
  const grid = { columns: v.columns, rows: v.rows };
  return Object.values(v.cells).every(
    (cell) => typeof cell === "object" && cell !== null && fits(cell as Cell, grid),
  );
}
