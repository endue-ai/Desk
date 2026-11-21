// @vitest-environment jsdom
// The grid's Mod+C (#504): the block as tab-separated text with an HTML table of the same cells
// beside it, a spreadsheet's way to paste cells; a block past 100,000 cells is handed to Copy as
// TSV, which asks first, and the browser's own copy writes nothing meanwhile. The table escapes its
// text, keeps a line break in its cell and leaves NULL's cell empty.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachPointer } from "../ui/grid/pointer.js";
import { htmlTable } from "../ui/results.js";

type Row = (string | null)[];
const set = {
  columns: ["id", "name", "note"],
  rows: [
    ["1", "Ada", 'a<b & "c"'],
    ["2", "Bob", null],
  ] as Row[],
  truncated: false,
};

let grid: HTMLElement;
let selection: { sorted: Row[]; rows?: number[]; columns?: number[] } | undefined;
let copyLarge: ReturnType<typeof vi.fn<() => void>>;

const copy = () => {
  const data: Record<string, string> = {};
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (type: string, text: string) => {
        data[type] = text;
      },
    },
  });
  document.dispatchEvent(event);
  return { data, prevented: event.defaultPrevented };
};

beforeEach(() => {
  document.body.innerHTML = `<div role="grid" tabindex="0"></div>`;
  grid = document.querySelector("[role=grid]") as HTMLElement;
  copyLarge = vi.fn<() => void>();
  selection = { sorted: set.rows, rows: [0, 1], columns: [1, 2] };
  const screen = { grid, set: () => set, cursorColumn: () => 1 };
  attachPointer(document, screen as never, {
    record: () => false,
    editing: () => false,
    sortBy: () => {},
    startEdit: () => {},
    openMenu: () => {},
    selection: () => selection,
    cursorRow: () => 0,
    copyLarge,
  });
  grid.focus();
});

describe("the grid's Mod+C", () => {
  it("puts the block's text and an HTML table of the same cells on the clipboard", () => {
    const { data, prevented } = copy();
    expect(prevented).toBe(true);
    expect(data).toEqual({
      "text/plain": 'Ada\ta<b & "c"\nBob\t\\N',
      "text/html":
        "<table><tr><td>Ada</td><td>a&lt;b &amp; &quot;c&quot;</td></tr>" +
        "<tr><td>Bob</td><td></td></tr></table>",
    });
    expect(copyLarge).not.toHaveBeenCalled();
  });

  it("hands a block past 100,000 cells to Copy as TSV and writes nothing itself", () => {
    const rows = Array.from({ length: 50_001 }, (_, i) => i);
    selection = { sorted: rows.map((i) => [String(i), "x", null]), rows, columns: [0, 1] };
    const { data, prevented } = copy();
    expect(copyLarge).toHaveBeenCalledOnce();
    expect(data).toEqual({});
    expect(prevented).toBe(false);
  });
});

describe("the HTML table", () => {
  it("keeps a line break in its cell, and picks the rows and columns asked", () => {
    const lines = { columns: ["a", "b"], rows: [["one\ntwo", "3"]] as Row[], truncated: false };
    expect(htmlTable(lines)).toBe("<table><tr><td>one<br>two</td><td>3</td></tr></table>");
    expect(htmlTable(lines, { columns: [1] })).toBe("<table><tr><td>3</td></tr></table>");
    expect(htmlTable(set, { rows: [set.rows[1] ?? []], columns: [0, 2] })).toBe(
      "<table><tr><td>2</td><td></td></tr></table>",
    );
  });
});
